#!/usr/bin/env python3
"""Config master for Orca ADE (one service, control panel, no relay). Writes the
full config with templateUpsertConfig, then reads it back and asserts every field.
The w/ Relay sibling is relay_template.py.  Usage: repair.py [image-tag]"""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

TEMPLATE_ID = "8229a738-6b5c-420a-8f88-f2dfe1831f66"
WORKSPACE = "fc4796db-2c6c-4354-a564-d4a1d900af53"  # Auromations
NAME = "Orca ADE"
SERVICE = "9a0af3ad-15c6-4a55-ae7e-c9d7756401ea"
IMAGE = f"ghcr.io/hmseeb/orca-railway:{sys.argv[1] if len(sys.argv) > 1 else '1.4.210'}"


def var(default, description, optional=False):
    return {"isOptional": optional, "defaultValue": default, "description": description}


VARIABLES = {
    # Setting ORCA_PASSWORD puts the image in control mode: the control panel owns
    # $PORT, Orca runs behind it, and the service URL opens the panel.
    "ORCA_PASSWORD": var(None, "Choose a password. After deploying, open this service's URL: it takes you to your control panel (sign-in link, QR code, devices). Sign in there with this password."),
    "PORT": var("8080", "Port the control panel and Orca listen on. Matches the domain's target port."),
    "GIT_USER_NAME": var("", "Optional. Name on commits made on this server, e.g. Ada Lovelace.", True),
    "GIT_USER_EMAIL": var("", "Optional. Email on commits made on this server.", True),
    "GH_TOKEN": var("", "Optional. GitHub token so gh and git push work right away. Leave empty to run gh auth login in an Orca terminal instead.", True),
    "ORCA_PAIRING_ADDRESS": var("", "Optional. Only for a custom domain: set it to https://your.domain so pairing links point there.", True),
}
CONFIG = {"buckets": {}, "services": {SERVICE: {
    "icon": None, "name": "orca",
    "deploy": {"startCommand": None, "healthcheckPath": "/control/health",
               "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10},
    "source": {"image": IMAGE},
    "variables": VARIABLES,
    "networking": {"serviceDomains": {"<hasDomain>:8080": {"port": 8080}}},
    "volumeMounts": {SERVICE: {"mountPath": "/data"}},
}}}
CANVAS = {"groups": {}, "groupRefs": {SERVICE: None}, "positions": {}}


def main():
    rw.gql("mutation($id: String!, $input: TemplateUpsertConfigInput!) { templateUpsertConfig(id: $id, input: $input) { id } }",
           {"id": TEMPLATE_ID, "input": {"name": NAME, "workspaceId": WORKSPACE,
                                         "serializedConfig": CONFIG, "canvasConfig": CANVAS}}, internal=True)
    got = rw.gql("query($id: String!){ template(id:$id){ code status serializedConfig } }", {"id": TEMPLATE_ID})["template"]
    have, want = got["serializedConfig"]["services"][SERVICE], CONFIG["services"][SERVICE]
    fails = [k for k in ("source", "networking", "volumeMounts") if have.get(k) != want[k]]
    fails += [f"deploy.{k}" for k in ("healthcheckPath", "startCommand") if have["deploy"].get(k) != want["deploy"][k]]
    for name, v in VARIABLES.items():
        h = have["variables"].get(name) or {}
        if (h.get("defaultValue") or None) != (v["defaultValue"] or None) or bool(h.get("isOptional")) != v["isOptional"] or not h.get("description"):
            fails.append(f"{name} = {h!r}")
    if set(have["variables"]) != set(VARIABLES):
        fails.append(f"unexpected variables {sorted(set(have['variables']) ^ set(VARIABLES))}")
    print(f"template {TEMPLATE_ID} code {got['code']} ({got['status']})")
    if fails:
        sys.exit("FAILED: " + "; ".join(fails))
    print("all fields asserted back through the API")


if __name__ == "__main__":
    main()
