#!/usr/bin/env python3
"""Wait for the latest deployment of a service to settle; print status and the
pairing lines from its logs.  Usage: deploy_status.py <serviceId> <envId>"""
import pathlib, sys, time
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

svc, env = sys.argv[1], sys.argv[2]
for _ in range(80):
    d = rw.gql("""query($s:String!,$e:String!){ deployments(first:1,input:{serviceId:$s,environmentId:$e}){
      edges{ node{ id status } } } }""", {"s": svc, "e": env})["deployments"]["edges"]
    if d and d[0]["node"]["status"] not in ("QUEUED", "INITIALIZING", "BUILDING", "DEPLOYING", "WAITING"):
        break
    time.sleep(15)
dep = d[0]["node"]
print("STATUS", dep["status"], dep["id"])
logs = rw.gql("""query($d:String!){ deploymentLogs(deploymentId:$d, limit:500){ message } }""",
              {"d": dep["id"]})["deploymentLogs"]
for l in logs:
    m = l["message"]
    if any(k in m for k in ("ready", "endpoint", "Web client URL", "Pairing URL", "rror", "FAIL")):
        print(m[:400])
