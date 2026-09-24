#!/usr/bin/env python3
"""Repair the generated template config (templateGenerate strips literal
variable values), write via templateUpsertConfig, then assert it back."""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

TEMPLATE_ID = "8229a738-6b5c-420a-8f88-f2dfe1831f66"
WORKSPACE = "fc4796db-2c6c-4354-a564-d4a1d900af53"  # Auromations
NAME = sys.argv[1] if len(sys.argv) > 1 else "Orca ADE"
SERVICE = "9a0af3ad-15c6-4a55-ae7e-c9d7756401ea"
IMAGE = "ghcr.io/hmseeb/orca-railway:1.4.210"

VARIABLES = {
    "PORT": {"isOptional": False, "defaultValue": "6768",
             "description": "Port orca serve listens on. Matches the public domain's target port."},
    "ORCA_PAIRING_ADDRESS": {"isOptional": True, "defaultValue": "",
             "description": "Optional. Address clients dial. Leave empty to use this service's Railway domain; set it only when you attach a custom domain, e.g. https://orca.example.com"},
}
CONFIG = {"buckets": {}, "services": {SERVICE: {
    "icon": None, "name": "orca",
    "deploy": {"startCommand": None, "healthcheckPath": "/",
               "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10},
    "source": {"image": IMAGE},
    "variables": VARIABLES,
    "networking": {"serviceDomains": {"<hasDomain>:6768": {"port": 6768}}},
    "volumeMounts": {SERVICE: {"mountPath": "/data"}},
}}}
CANVAS = {"groups": {}, "groupRefs": {SERVICE: None}, "positions": {}}


def main():
    rw.gql("mutation($id: String!, $input: TemplateUpsertConfigInput!) { templateUpsertConfig(id: $id, input: $input) { id } }",
           {"id": TEMPLATE_ID, "input": {"name": NAME, "workspaceId": WORKSPACE,
                                         "serializedConfig": CONFIG, "canvasConfig": CANVAS}}, internal=True)
    got = rw.gql("query($id: String!){ template(id:$id){ name serializedConfig } }", {"id": TEMPLATE_ID})["template"]
    svc = got["serializedConfig"]["services"][SERVICE]
    fails = []
    if svc["source"].get("image") != IMAGE: fails.append("image")
    if svc["deploy"]["healthcheckPath"] != "/": fails.append("healthcheckPath")
    if svc["deploy"]["startCommand"] is not None: fails.append("startCommand must stay null (tini + orca-boot)")
    if svc["volumeMounts"][SERVICE]["mountPath"] != "/data": fails.append("volume")
    if svc["networking"]["serviceDomains"].get("<hasDomain>:6768", {}).get("port") != 6768: fails.append("domain port")
    for k, want in VARIABLES.items():
        have = svc["variables"].get(k) or {}
        for f in ("defaultValue", "isOptional", "description"):
            if (have.get(f) or None) != (want[f] or None) and not (f == "isOptional" and have.get(f) == want[f]):
                fails.append(f"{k}.{f} = {have.get(f)!r}")
    print(json.dumps(svc["variables"], indent=1))
    if fails:
        sys.exit("FAILED: " + ", ".join(fails))
    print("all repaired fields asserted back through the API")


if __name__ == "__main__":
    main()
