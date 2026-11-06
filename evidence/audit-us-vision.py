"""Read only the requested US Whale2API deployment. Never emit keys or account data."""
import json, sqlite3, subprocess, urllib.request

app=json.loads(subprocess.check_output(['docker','inspect','whale2api']))[0]
print(json.dumps({'image':app['Config']['Image'],'state':app['State']['Status']}))
db=sqlite3.connect('file:/www/whale2api/docker-data/whale2api.db?mode=ro',uri=True)
key=db.execute('select api_key from gateway_api_keys limit 1').fetchone()[0]
req=urllib.request.Request('http://127.0.0.1:5001/v1/models',headers={'Authorization':'Bearer '+key})
try:
    with urllib.request.urlopen(req,timeout=20) as res: data=json.load(res)
    print(json.dumps({'models':[row.get('id') for row in data.get('data',[])]}))
except Exception as error: print(json.dumps({'modelCatalogError':type(error).__name__}))
print(json.dumps({'mounts':[row['Destination'] for row in app.get('Mounts',[])]}))
db.close()
