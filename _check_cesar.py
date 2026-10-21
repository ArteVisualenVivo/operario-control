p="C:/Users/Cesar/Desktop/operario-control/sync-agent/agent.ts"
s=open(p,encoding="utf-8").read()
lines=s.splitlines()
in_cesar = False
brace_count = 0
start = None
end = None
for i,l in enumerate(lines):
    if "module === \"cesar\"" in l:
        start = i
        in_cesar = True
        brace_count = l.count("{") - l.count("}")
    elif in_cesar:
        brace_count += l.count("{") - l.count("}")
        if brace_count <= 0:
            end = i
            break
if start is not None and end is not None:
    for i in range(start, min(end+1, start+100)):
        print(f"{i+1}: {lines[i]}")
else:
    print("CESAR case not found")
