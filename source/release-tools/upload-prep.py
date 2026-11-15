#!/usr/bin/env python3
"""Upload installer blobs and commit the preview-only transfer workflow.

Does not create, attach assets to, or publish a release.  The workflow must be
manually dispatched separately and only attaches to the pre-validated draft.
"""
import argparse, base64, concurrent.futures, hashlib, json, pathlib, subprocess, sys

p=argparse.ArgumentParser(); p.add_argument('prepared_dir',type=pathlib.Path); a=p.parse_args()
root=pathlib.Path(__file__).resolve().parent; plan=json.loads((a.prepared_dir/'karevo-preview-plan.json').read_text())
repo='Yusufozkal/karevo'
subprocess.run(['node','-e',"require('./attach-preview.cjs').validatePlan(JSON.parse(require('node:fs').readFileSync(0,'utf8')))"], input=json.dumps(plan).encode(),cwd=root,check=True)
sources=[]
for asset_index, item in enumerate(plan['assets'],1):
    full=hashlib.sha256()
    for chunk_index, chunk in enumerate(item['chunks'],1):
        file=a.prepared_dir/f'asset-{asset_index:02d}-blob-{chunk_index:02d}.json'
        body=json.loads(file.read_text())
        if set(body)!={'content','encoding'} or body['encoding']!='base64': raise SystemExit('Invalid prepared blob body')
        data=base64.b64decode(body['content'],validate=True)
        digest=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
        if len(data)!=chunk['bytes'] or hashlib.sha256(data).hexdigest()!=chunk['sha256'] or digest!=chunk['sha']:
            raise SystemExit('Prepared blob verification failed before upload')
        full.update(data); sources.append((chunk,file))
    if full.hexdigest()!=item['sha256']: raise SystemExit('Prepared asset digest mismatch before upload')

def gh(endpoint, method='GET', data=None, file=None):
    cmd=['gh','api','--method',method,f'repos/{repo}/{endpoint}'];
    if file is not None:
        with file.open('rb') as handle:
            result=subprocess.run(cmd+['--input','-'],stdin=handle,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    else:
        result=subprocess.run(cmd+(['--input','-'] if data is not None else []),input=json.dumps(data).encode() if data is not None else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode: raise RuntimeError('GitHub API call failed: '+result.stderr.decode('utf-8','replace')[:1000])
    return json.loads(result.stdout)

def upload(i):
    chunk,file=sources[i]; result=gh('git/blobs','POST',file=file)
    if result.get('sha')!=chunk['sha']: raise RuntimeError(f'Blob {i+1} digest mismatch')
    return i+1
draft=gh('releases/'+str(plan['releaseId']))
if not (draft.get('id')==plan['releaseId'] and draft.get('tag_name')==plan['tag'] and draft.get('draft') is True and draft.get('prerelease') is True):
    raise SystemExit('The destination must be the expected unpublished prerelease draft')
expected={item['fileName']:item for item in plan['assets']}
seen=set()
for asset in draft.get('assets',[]):
    item=expected.get(asset.get('name'))
    if not item or asset['name'] in seen or asset.get('state')!='uploaded' or asset.get('size')!=item['bytes'] or asset.get('digest')!='sha256:'+item['sha256']:
        raise SystemExit('Destination draft contains an unexpected or unverified asset')
    seen.add(asset['name'])
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    for i in pool.map(upload,range(len(sources))): print(f'Uploaded and verified chunk {i}/{len(sources)}',flush=True)
head=gh('git/ref/heads/main')['object']['sha']; base=gh('git/commits/'+head)['tree']['sha']
files={'publisher/karevo-preview-plan.json':a.prepared_dir/'karevo-preview-plan.json','publisher/attach-karevo-preview.cjs':root/'attach-preview.cjs','.github/workflows/attach-karevo-preview.yml':root/'attach-karevo-preview.yml'}
entries=[]
for path,source in files.items():
    blob=gh('git/blobs','POST',data={'content':base64.b64encode(source.read_bytes()).decode(),'encoding':'base64'})['sha']
    entries.append({'path':path,'mode':'100644','type':'blob','sha':blob})
tree=gh('git/trees','POST',data={'base_tree':base,'tree':entries})['sha']
commit=gh('git/commits','POST',data={'message':'Prepare verified Karevo preview transfer','tree':tree,'parents':[head]})['sha']
if gh('git/ref/heads/main')['object']['sha']!=head: raise RuntimeError('main changed during preparation; no ref update attempted')
gh('git/refs/heads/main','PATCH',data={'sha':commit,'force':False})
print(json.dumps({'commit':commit,'releaseId':plan['releaseId'],'tag':plan['tag'],'published':False}))
