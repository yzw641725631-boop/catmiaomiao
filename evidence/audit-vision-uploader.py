"""Read-only owned deployment file inventory; do not print environment or credentials."""
import json,subprocess,pathlib,os
import re
app=json.loads(subprocess.check_output(['docker','inspect','whale2api']))[0]
print(json.dumps({'workingDir':app['Config']['WorkingDir']}))
result=subprocess.run(['docker','exec','whale2api','ls','-l','/app'],capture_output=True,text=True)
print(result.stdout[:5000])
logs=subprocess.run(['docker','logs','--since','12m','--tail','500','whale2api'],capture_output=True,text=True)
for line in (logs.stdout+'\n'+logs.stderr).splitlines():
 if not re.search(r'inline.*(?:fail|error)|(?:fail|error).*upload',line,re.I): continue
 line=re.sub(r'https?://[^\s"<>]+','[url]',line)
 line=re.sub(r'[\w.+-]+@[\w.-]+','[account]',line)
 line=re.sub(r'(?:Bearer\s+|(?:sk|sck)[_-])[\w.-]+','[redacted]',line,flags=re.I)
 print(line[:1400])
for base,dirs,files in os.walk('/www/whale2api'):
 dirs[:]=[name for name in dirs if name not in ('.git','node_modules','docker-data','vendor','dist')]
 for name in files:
  p=pathlib.Path(base)/name
  if p.suffix not in ('.go','.py','.ts','.js') or p.stat().st_size>2000000: continue
  lines=p.read_text(errors='replace').splitlines()
  for i,line in enumerate(lines):
   if 'Failed to upload inline file.' in line:
    print(json.dumps({'file':str(p),'line':i+1,'context':'\n'.join(lines[max(0,i-12):i+5])}))
