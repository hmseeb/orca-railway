#!/usr/bin/env python3
"""Upgrade an existing Orca ADE project to the Orca ADE (w/ Relay) layout without
touching its volume: add a `relay` service (volume + domain), switch `orca` to
control mode (ORCA_PASSWORD, PORT 8080, /control/health, domain -> 8080).
Password goes to the Keychain (service orca-server, account password).
Usage: upgrade_in_place.py <projectId> <envId> <orcaServiceId> <orcaDomainId> <orcaDomain> [tag]"""
import pathlib, secrets, subprocess, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

pid, env, orca, domain_id, orca_domain = sys.argv[1:6]
tag = sys.argv[6] if len(sys.argv) > 6 else "1.4.210"
q = rw.gql
password = secrets.token_urlsafe(15)
subprocess.run(["security", "add-generic-password", "-U", "-s", "orca-server", "-a", "password", "-w", password], check=True)

relay = q("""mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }""",
          {"input": {"projectId": pid, "environmentId": env, "name": "relay",
                     "source": {"image": f"ghcr.io/hmseeb/orca-railway-relay:{tag}"},
                     "variables": {"PORT": "8080", "ORCA_PASSWORD": password,
                                   "ORCA_URL": "https://${{orca.RAILWAY_PUBLIC_DOMAIN}}"}}})["serviceCreate"]["id"]
q("""mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }""",
  {"s": relay, "e": env, "input": {"healthcheckPath": "/health", "healthcheckTimeout": 120,
                                   "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10}})
q("""mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }""",
  {"input": {"projectId": pid, "environmentId": env, "serviceId": relay, "mountPath": "/data"}})
relay_domain = q("""mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }""",
                 {"input": {"environmentId": env, "serviceId": relay, "targetPort": 8080}})["serviceDomainCreate"]["domain"]

q("""mutation($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }""",
  {"input": {"projectId": pid, "environmentId": env, "serviceId": orca, "skipDeploys": True, "variables": {
      "PORT": "8080", "ORCA_PASSWORD": "${{relay.ORCA_PASSWORD}}",
      "RELAY_URL": "https://${{relay.RAILWAY_PUBLIC_DOMAIN}}"}}})
q("""mutation($s: String!, $e: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $s, environmentId: $e, input: $input) }""",
  {"s": orca, "e": env, "input": {"healthcheckPath": "/control/health", "healthcheckTimeout": 300,
                                  "source": {"image": f"ghcr.io/hmseeb/orca-railway:{tag}"}}})
q("""mutation($input: ServiceDomainUpdateInput!) { serviceDomainUpdate(input: $input) }""",
  {"input": {"serviceDomainId": domain_id, "domain": orca_domain, "environmentId": env, "serviceId": orca, "targetPort": 8080}})
for sid in (relay, orca):
    q("""mutation($s: String!, $e: String!) { serviceInstanceDeployV2(serviceId: $s, environmentId: $e) }""", {"s": sid, "e": env})
print(f"RELAY={relay}\nRELAY_URL=https://{relay_domain}")
