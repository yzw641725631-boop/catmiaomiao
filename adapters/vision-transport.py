"""SSH transport to the owned US deployment; its gateway key stays on that server."""
import concurrent.futures, json, pathlib, shlex, sys, threading
root=pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0,str(root/'projects/sub2api/ops/galaxy-portal'))
from remote import Remote

REMOTE_CODE=r'''
import concurrent.futures,json,sqlite3,sys,threading,urllib.request,urllib.error
lock=threading.Lock()
def send(row):
 with lock: print(json.dumps(row,ensure_ascii=False),flush=True)
def run(row):
 try:
  body=row['body'];body['model']='deepseek-v4.1-flash-vision-exp';body['stream']=False
  db=sqlite3.connect('file:/www/whale2api/docker-data/whale2api.db?mode=ro',uri=True)
  key=db.execute('select api_key from gateway_api_keys limit 1').fetchone()[0];db.close()
  req=urllib.request.Request('http://127.0.0.1:5001/v1/chat/completions',data=json.dumps(body).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=170) as res:
   data=res.read(4*1024*1024+1)
   if len(data)>4*1024*1024: raise ValueError('response_limit')
   result=json.loads(data)
  send({'id':row['id'],'result':result})
 except urllib.error.HTTPError as error:
  code='VISION_UPSTREAM_ERROR'
  try:
   detail=json.loads(error.read(65536)).get('error',{})
   if detail.get('message')=='Failed to upload inline file.': code='VISION_IMAGE_UPLOAD_FAILED'
  except Exception: pass
  send({'id':row.get('id'),'error':{'status':error.code,'code':code}})
 except Exception:
  send({'id':row.get('id'),'error':{'status':502,'code':'VISION_REQUEST_FAILED'}})
send({'ready':True,'model':'deepseek-v4.1-flash-vision-exp'})
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 for line in sys.stdin:
  try: pool.submit(run,json.loads(line))
  except Exception: send({'error':{'status':400,'code':'VISION_INVALID_INPUT'}})
'''
remote=None
try:
    remote=Remote('us')
    stdin,stdout,stderr=remote.client.exec_command('python3 -u -c '+shlex.quote(REMOTE_CODE),timeout=180)
    def forward():
        try:
            for line in sys.stdin: stdin.write(line);stdin.flush()
        finally:
            try: stdin.channel.shutdown_write()
            except Exception: pass
    threading.Thread(target=forward,daemon=True).start()
    for line in stdout: print(line.rstrip(),flush=True)
except Exception:
    print(json.dumps({'fatal':'VISION_TRANSPORT_UNAVAILABLE'}),flush=True)
finally:
    if remote: remote.close()
