#!/usr/bin/env python3
"""Builds the live source project for Orca ADE (w/ Relay) in Auromations: two
services (orca, relay), each with a volume and a domain. The password is
generated here and stored in the Keychain (service orca-relay-source)."""
import pathlib, secrets, subprocess, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

WORKSPACE = "fc4796db-2c6c-4354-a564-d4a1d900af53"  # Auromations
TAG = sys.argv[1] if len(sys.argv) > 1 else "1.4.210"
q = rw.gql
password = secrets.token_urlsafe(15)
subprocess.run(["security", "add-generic-password", "-U", "-s", "orca-relay-source", "-a", "owner", "-w", password], check=True)

p = q("""mutation($input: ProjectCreateInput!) { projectCreate(input: $input) {
  id environments { edges { node { id name } } } } }""", {"input": {"name": "orca-relay-source", "workspaceId": WORKSPACE}})["projectCreate"]
pid = p["id"]
env = next(e["node"]["id"] for e in p["environments"]["edges"] if e["node"]["name"] == "production")


def service(name, image, variables, health):
    sid = q("""mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }""",
            {"input": {"projectId": pid, "environmentId": env, "name": name, "source": {"image": image},
                       "variables": variables}})["serviceCreate"]["id"]
    q("""mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) {
      serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }""",
      {"s": sid, "e": env, "input": {"healthcheckPath": health, "healthcheckTimeout": 300,
                                     "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10}})
    q("""mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }""",
      {"input": {"projectId": pid, "environmentId": env, "serviceId": sid, "mountPath": "/data"}})
    domain = q("""mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }""",
               {"input": {"environmentId": env, "serviceId": sid, "targetPort": 8080}})["serviceDomainCreate"]["domain"]
    return sid, domain


relay, relay_domain = service("relay", f"ghcr.io/hmseeb/orca-railway-relay:{TAG}", {
    "PORT": "8080", "ORCA_PASSWORD": password, "ORCA_URL": "https://${{orca.RAILWAY_PUBLIC_DOMAIN}}",
}, "/health")
orca, orca_domain = service("orca", f"ghcr.io/hmseeb/orca-railway:{TAG}", {
    "PORT": "8080", "ORCA_PASSWORD": "${{relay.ORCA_PASSWORD}}",
    "RELAY_URL": "https://${{relay.RAILWAY_PUBLIC_DOMAIN}}",
    "GIT_USER_NAME": "", "GIT_USER_EMAIL": "", "GH_TOKEN": "",
}, "/control/health")
for sid in (relay, orca):
    q("""mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }""",
      {"s": sid, "e": env})
print(f"PROJECT={pid}\nENV={env}\nORCA={orca}\nRELAY={relay}\nORCA_URL=https://{orca_domain}\nRELAY_URL=https://{relay_domain}")
