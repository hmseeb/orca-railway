#!/usr/bin/env python3
"""Deploy Orca ADE into a fresh project exactly as the Deploy button does,
answering the password prompt (stored in the Keychain).
Usage: deploy_as_stranger.py <workspaceId> <keychain-service> [project-name]"""
import copy, pathlib, secrets, subprocess, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402
from repair import TEMPLATE_ID, SERVICE

workspace, keychain = sys.argv[1], sys.argv[2]
name = sys.argv[3] if len(sys.argv) > 3 else None
password = secrets.token_urlsafe(15)
subprocess.run(["security", "add-generic-password", "-U", "-s", keychain, "-a", "owner", "-w", password], check=True)
cfg = copy.deepcopy(rw.gql("query($id:String!){ template(id:$id){ serializedConfig } }", {"id": TEMPLATE_ID})["template"]["serializedConfig"])
cfg["services"][SERVICE]["variables"]["ORCA_PASSWORD"]["value"] = password
pid = rw.gql("mutation($i: TemplateDeployV2Input!){ templateDeployV2(input:$i){ projectId } }",
             {"i": {"templateId": TEMPLATE_ID, "workspaceId": workspace, "serializedConfig": cfg}})["templateDeployV2"]["projectId"]
if name:
    rw.gql("mutation($id:String!,$n:String!){ projectUpdate(id:$id, input:{name:$n}){ id } }", {"id": pid, "n": name})
print("PROJECT", pid)
