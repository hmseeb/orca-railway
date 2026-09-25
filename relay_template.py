#!/usr/bin/env python3
"""Writes the Orca ADE (w/ Relay) template config straight into Auromations with
templateUpsertConfig (the composer's own Save; it creates the template on first
run), then reads it back and asserts every field. There is no source project:
this file IS the regeneration master.  Usage: relay_template.py [image-tag]"""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

TEMPLATE_ID = "721e2b59-15e1-42fd-bd0f-7e6258bbe62d"
ORCA = "884f3630-bb88-450b-a5d4-fbdcdcb6829b"
RELAY = "36e37aca-5666-4601-b334-879c5d07b95c"
WORKSPACE = "fc4796db-2c6c-4354-a564-d4a1d900af53"  # Auromations
NAME = "Orca ADE (w/ Relay)"
TAG = sys.argv[1] if len(sys.argv) > 1 else "1.4.210"


def var(default, description, optional=False):
    return {"isOptional": optional, "defaultValue": default, "description": description}


ORCA_VARS = {
    "PORT": var("8080", "Port the control page and Orca proxy listen on. Matches the domain's target port."),
    "ORCA_PASSWORD": var("${{relay.ORCA_PASSWORD}}", "Shared with the relay service. Change it there."),
    "RELAY_URL": var("https://${{relay.RAILWAY_PUBLIC_DOMAIN}}", "Link from the control page to the relay admin."),
    "GIT_USER_NAME": var("", "Optional. Name on commits made on this server, e.g. Ada Lovelace.", True),
    "GIT_USER_EMAIL": var("", "Optional. Email on commits made on this server.", True),
    "GH_TOKEN": var("", "Optional. GitHub token so gh and git push work right away. Leave empty to run gh auth login in an Orca terminal instead.", True),
}
RELAY_VARS = {
    "PORT": var("8080", "Port the relay, sign-in and admin page listen on. Matches the domain's target port."),
    # No default on purpose: the deployer has to know it to open /control and /admin
    # and to sign computers in, so it is the one required field on the deploy form.
    "ORCA_PASSWORD": var(None, "Choose a password. After deploying, open the orca service's URL: it takes you to your control panel (sign-in link, QR code, devices). Sign in there with this password. It also protects the relay admin page."),
    "ORCA_URL": var("https://${{orca.RAILWAY_PUBLIC_DOMAIN}}", "Link from the relay admin to the Orca control page."),
}


def svc(sid, name, image, variables, health, icon):
    return {
        "icon": icon, "name": name,
        "deploy": {"startCommand": None, "healthcheckPath": health,
                   "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10},
        "source": {"image": image},
        "variables": variables,
        "networking": {"serviceDomains": {"<hasDomain>:8080": {"port": 8080}}},
        "volumeMounts": {sid: {"mountPath": "/data"}},
    }


ICON = "https://raw.githubusercontent.com/stablyai/orca/98584332a31acc0c0d60115edf03486068a35987/resources/icon.png"
CONFIG = {"buckets": {}, "services": {
    ORCA: svc(ORCA, "orca", f"ghcr.io/hmseeb/orca-railway:{TAG}", ORCA_VARS, "/control/health", ICON),
    RELAY: svc(RELAY, "relay", f"ghcr.io/hmseeb/orca-railway-relay:{TAG}", RELAY_VARS, "/health", None),
}}
CANVAS = {"groups": {}, "groupRefs": {ORCA: None, RELAY: None}, "positions": {}}


def main():
    rw.gql("mutation($id: String!, $input: TemplateUpsertConfigInput!) { templateUpsertConfig(id: $id, input: $input) { id } }",
           {"id": TEMPLATE_ID, "input": {"name": NAME, "workspaceId": WORKSPACE,
                                         "serializedConfig": CONFIG, "canvasConfig": CANVAS}}, internal=True)
    got = rw.gql("query($id: String!){ template(id:$id){ id code serializedConfig } }", {"id": TEMPLATE_ID})["template"]
    fails = []
    for sid, want in CONFIG["services"].items():
        have = got["serializedConfig"]["services"].get(sid)
        if not have:
            fails.append(f"{want['name']} missing"); continue
        for k in ("name", "source", "networking", "volumeMounts"):
            if have.get(k) != want[k]: fails.append(f"{want['name']}.{k} = {have.get(k)!r}")
        for k in ("healthcheckPath", "startCommand"):
            if have["deploy"].get(k) != want["deploy"][k]: fails.append(f"{want['name']}.deploy.{k}")
        for name, v in want["variables"].items():
            h = have["variables"].get(name) or {}
            if (h.get("defaultValue") or None) != (v["defaultValue"] or None) or bool(h.get("isOptional")) != v["isOptional"] or not h.get("description"):
                fails.append(f"{want['name']}.{name} = {h!r}")
    print(f"template {got['id']} code {got['code']}")
    if fails:
        sys.exit("FAILED: " + "; ".join(fails))
    print("all fields asserted back through the API")


if __name__ == "__main__":
    main()
