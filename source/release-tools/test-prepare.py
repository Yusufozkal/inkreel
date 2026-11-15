#!/usr/bin/env python3
"""Validate local artifact selection and reject tampering before gh is invoked."""
import base64, copy, hashlib, json, os, pathlib, subprocess, tempfile, zipfile

root=pathlib.Path(__file__).resolve().parent
with tempfile.TemporaryDirectory() as tmp:
    t=pathlib.Path(tmp); exe=t/'Karevo-3.2.3-Setup.exe'; apk=t/'Karevo-3.1.3-Android.apk'
    exe.write_bytes(b'MZ local public executable fixture')
    with zipfile.ZipFile(apk,'w') as z:
        z.writestr('AndroidManifest.xml',b'manifest fixture'); z.writestr('classes.dex',b'dex fixture')
    def prepare(output,installer=exe,android=apk,release='123'):
        return subprocess.run(['python',str(root/'prepare.py'),str(installer),str(android),release,str(output)],capture_output=True,text=True)
    prepared=t/'prepared'; result=prepare(prepared); assert result.returncode==0,result.stderr
    plan=json.loads((prepared/'karevo-preview-plan.json').read_text())
    assert plan['schema']=='karevo-preview-upload-v2' and plan['repository']=='Yusufozkal/karevo'
    assert plan['tag']=='karevo-v3.2.3-preview' and len(plan['assets'])==2
    for item,source in zip(plan['assets'],(exe,apk)):
        assert item['fileName']==source.name and item['bytes']==source.stat().st_size
        assert item['sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
    checked=subprocess.run(['node','-e',"require('./attach-preview.cjs').validatePlan(JSON.parse(require('fs').readFileSync(0,'utf8')))"],cwd=root,input=json.dumps(plan),capture_output=True,text=True)
    assert checked.returncode==0,checked.stderr
    count=1
    for name,kwargs in [('invalid ID',{'release':'0'}),('wrong source name',{'installer':t/'private-key.pem'})]:
        (t/'private-key.pem').write_bytes(b'not-public-fixture')
        output=t/('bad-'+str(count)); no=prepare(output,**kwargs)
        assert no.returncode!=0 and not output.exists(),(name,no.stdout,no.stderr); count+=1
    original=exe.read_bytes(); exe.write_bytes(b'not an executable')
    output=t/'bad-exe'; no=prepare(output); assert no.returncode!=0 and not output.exists(); count+=1
    exe.write_bytes(original); original=apk.read_bytes()
    with zipfile.ZipFile(apk,'w') as z: z.writestr('private-key.pem',b'not-public-fixture')
    output=t/'bad-apk'; no=prepare(output); assert no.returncode!=0 and not output.exists(); count+=1
    apk.write_bytes(original)
    no=prepare(prepared); assert no.returncode!=0; count+=1
    # A local gh double fails if validation lets a malformed upload reach it.
    (t/'bin').mkdir(); fake=t/'bin/gh'; fake.write_text('#!/bin/sh\necho called >> "$GH_MARKER"\nexit 3\n'); fake.chmod(0o755)
    marker=t/'gh-called'; env={**os.environ,'PATH':str(t/'bin')+':'+os.environ['PATH'],'GH_MARKER':str(marker)}
    plan_file=prepared/'karevo-preview-plan.json'; blob=prepared/'asset-01-blob-01.json'; original_blob=blob.read_text()
    def upload_fails():
        result=subprocess.run(['python',str(root/'upload-prep.py'),str(prepared)],env=env,capture_output=True,text=True)
        assert result.returncode!=0 and not marker.exists(),(result.stdout,result.stderr)
    changed=copy.deepcopy(plan); changed['privateKey']='not-public'
    plan_file.write_text(json.dumps(changed)); upload_fails(); count+=1
    plan_file.write_text(json.dumps(plan)); body=json.loads(original_blob); body['content']=base64.b64encode(b'corrupted').decode()
    blob.write_text(json.dumps(body)); upload_fails(); count+=1
    blob.write_text(original_blob); changed=copy.deepcopy(plan); changed['assets'][1]['sha256']='0'*64
    plan_file.write_text(json.dumps(changed)); upload_fails(); count+=1
    print(f'Local preparation guards: {count} passed; no network requests performed')
