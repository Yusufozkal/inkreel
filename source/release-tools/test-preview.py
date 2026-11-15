#!/usr/bin/env python3
"""Exercise release guards using a local gh double; never contacts GitHub."""
import copy, hashlib, json, os, pathlib, shutil, subprocess, tempfile

root=pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as tmp:
    t=pathlib.Path(tmp); (t/'bin').mkdir(); (t/'publisher').mkdir()
    shutil.copy(root/'attach-preview.cjs',t/'publisher/attach-preview.cjs')
    contents=[b'MZ public installer test fixture',b'PK public Android APK test fixture']
    assets=[]
    for i,(name,content) in enumerate(zip(('Karevo-3.2.3-Setup.exe','Karevo-3.1.3-Android.apk'),contents)):
        git=hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest(); digest=hashlib.sha256(content).hexdigest()
        (t/git).write_bytes(content)
        assets.append({'fileName':name,'bytes':len(content),'sha256':digest,'chunks':[{'sha':git,'bytes':len(content),'sha256':digest}]})
    plan={'schema':'karevo-preview-upload-v2','repository':'Yusufozkal/karevo','releaseId':123,'tag':'karevo-v3.2.3-preview','assets':assets}
    fake='''#!/usr/bin/env python3
import hashlib,json,os,pathlib,sys,urllib.parse
root=pathlib.Path(os.environ['FAKE_DIR']); a=sys.argv[1:]
state=json.loads((root/'state.json').read_text())
with (root/'calls.jsonl').open('a') as f: f.write(json.dumps(a)+'\\n')
if a[:2]==['api','repos/Yusufozkal/karevo/releases/123']:
 out=state[:]
 if os.environ.get('DUPLICATE_SERVER')=='1' and out: out.append(out[0])
 if os.environ.get('OMIT_FINAL')=='1' and len(out)==2: out=out[:1]
 print(json.dumps({'id':124 if os.environ.get('WRONG_ID')=='1' else 123,'tag_name':'wrong' if os.environ.get('WRONG_TAG')=='1' else 'karevo-v3.2.3-preview','draft':os.environ.get('PUBLISHED')!='1' and not(os.environ.get('TRANSITION_PUBLISHED')=='1' and len(state)>0),'prerelease':os.environ.get('STABLE')!='1','assets':out}))
elif len(a)>1 and a[1].startswith('repos/Yusufozkal/karevo/git/blobs/'):
 sha=a[1].rsplit('/',1)[-1]; data=(root/sha).read_bytes()
 plan=json.loads((root/'publisher/karevo-preview-plan.json').read_text())
 bad=os.environ.get('BAD_CHUNK')
 if bad and sha==plan['assets'][int(bad)]['chunks'][0]['sha']: data=b'corrupted'
 sys.stdout.buffer.write(data)
elif a[:3]==['api','--method','POST'] and a[3].startswith('https://uploads.github.com/repos/Yusufozkal/karevo/releases/123/assets?name='):
 name=urllib.parse.parse_qs(urllib.parse.urlparse(a[3]).query)['name'][0]
 data=pathlib.Path(a[a.index('--input')+1]).read_bytes()
 asset={'name':name,'state':'uploaded','size':len(data),'digest':'sha256:'+hashlib.sha256(data).hexdigest()}
 state.append(asset); (root/'state.json').write_text(json.dumps(state))
 if os.environ.get('BAD_UPLOAD_HASH')=='1': asset['digest']='sha256:'+'0'*64
 print(json.dumps(asset))
else: sys.exit(2)
'''
    (t/'bin/gh').write_text(fake); (t/'bin/gh').chmod(0o755)
    env={**os.environ,'PATH':str(t/'bin')+':'+os.environ['PATH'],'GITHUB_REPOSITORY':'Yusufozkal/karevo','GITHUB_REF':'refs/heads/main','FAKE_DIR':str(t)}
    def existing(item): return {'name':item['fileName'],'state':'uploaded','size':item['bytes'],'digest':'sha256:'+item['sha256']}
    count=0
    def run(label, success, uploads, extra=None, state=None, changed=None, calls_allowed=True):
        global count
        (t/'state.json').write_text(json.dumps(state or [])); (t/'calls.jsonl').write_text('')
        (t/'publisher/karevo-preview-plan.json').write_text(json.dumps(changed or plan))
        result=subprocess.run(['node',str(t/'publisher/attach-preview.cjs')],env={**env,**(extra or {})},capture_output=True,text=True)
        calls=[json.loads(line) for line in (t/'calls.jsonl').read_text().splitlines()]
        actual=sum(c[:3]==['api','--method','POST'] for c in calls)
        assert (result.returncode==0)==success,(label,result.stdout,result.stderr)
        assert actual==uploads,(label,actual,uploads)
        assert calls_allowed or not calls,(label,calls)
        assert not any('latest' in arg or 'PATCH'==arg or 'DELETE'==arg for c in calls for arg in c),(label,calls)
        count+=1
    run('two assets upload',True,2)
    run('complete draft idempotent',True,0,state=[existing(a) for a in assets])
    run('partial draft resume',True,1,state=[existing(assets[0])])
    run('wrong branch',False,0,{'GITHUB_REF':'refs/heads/other'},calls_allowed=False)
    run('old repository',False,0,{'GITHUB_REPOSITORY':'Yusufozkal/bulten-guncellemeler'},calls_allowed=False)
    for guard in ('PUBLISHED','WRONG_ID','WRONG_TAG','STABLE'):
        run(guard,False,0,{guard:'1'})
    foreign=existing(assets[0]); foreign['name']='private-key.pem'
    run('foreign existing asset',False,0,state=[foreign])
    run('duplicate server assets',False,0,{'DUPLICATE_SERVER':'1'},[existing(assets[0])])
    wrong=existing(assets[0]); wrong['digest']='sha256:'+'0'*64
    run('existing asset digest',False,0,state=[wrong])
    run('corrupt Windows chunk',False,0,{'BAD_CHUNK':'0'})
    run('corrupt Android chunk before any upload',False,0,{'BAD_CHUNK':'1'})
    changed=copy.deepcopy(plan); changed['assets'][0]['sha256']='0'*64
    run('full asset digest',False,0,changed=changed)
    changed=copy.deepcopy(plan); changed['assets'][0]['fileName']='signing-key.zip'
    run('private or unknown filename',False,0,changed=changed,calls_allowed=False)
    changed=copy.deepcopy(plan); changed['assets'][1]=copy.deepcopy(changed['assets'][0])
    run('duplicate plan assets',False,0,changed=changed,calls_allowed=False)
    changed=copy.deepcopy(plan); changed['assets']=changed['assets'][:1]
    run('missing Android APK',False,0,changed=changed,calls_allowed=False)
    changed=copy.deepcopy(plan); changed['password']='not-public'
    run('extra plan secret field',False,0,changed=changed,calls_allowed=False)
    changed=copy.deepcopy(plan); changed['assets'][0]['source']='private-keystore'
    run('extra asset path field',False,0,changed=changed,calls_allowed=False)
    changed=copy.deepcopy(plan); changed['assets'][0]['chunks'][0]['source']='private-keystore'
    run('extra chunk path field',False,0,changed=changed,calls_allowed=False)
    run('published between asset uploads',False,1,{'TRANSITION_PUBLISHED':'1'})
    run('upload response digest',False,1,{'BAD_UPLOAD_HASH':'1'})
    run('incomplete final server set',False,2,{'OMIT_FINAL':'1'})
    print(f'Preview upload guard tests: {count} passed; no network requests performed')
