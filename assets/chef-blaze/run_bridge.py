import socket,json,pathlib,sys
code=pathlib.Path(sys.argv[1]).read_text()
s=socket.create_connection(('127.0.0.1',9876),15); s.settimeout(600)
s.sendall((json.dumps({'type':'execute','code':code,'strict_json':True})+'\0').encode())
b=b''
while b'\0' not in b:
    chunk=s.recv(1048576)
    if not chunk: raise RuntimeError('Blender connection closed')
    b += chunk
print(json.dumps(json.loads(b.split(b'\0')[0]), indent=2))
