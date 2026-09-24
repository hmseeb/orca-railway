#!/usr/bin/env python3
"""Builds the live Orca source project in Auromations (the regeneration master)."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402

WORKSPACE = "fc4796db-2c6c-4354-a564-d4a1d900af53"  # Auromations
IMAGE = "ghcr.io/hmseeb/orca-railway:1.4.210"
q = rw.gql

project = q("""mutation($input: ProjectCreateInput!) {
  projectCreate(input: $input) { id environments { edges { node { id name } } } } }""",
  {"input": {"name": "orca-source", "workspaceId": WORKSPACE}})["projectCreate"]
pid = project["id"]
env = next(e["node"]["id"] for e in project["environments"]["edges"] if e["node"]["name"] == "production")
print(f"project {pid} env {env}")

svc = q("""mutation($input: ServiceCreateInput!) { serviceCreate(input: $input) { id } }""",
  {"input": {"projectId": pid, "environmentId": env, "name": "orca", "source": {"image": IMAGE},
    "variables": {"PORT": "6768"}}})["serviceCreate"]["id"]
print(f"service {svc}")

# No start command: Railway would exec it raw and drop tini + orca-boot.
q("""mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
  serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }""",
  {"serviceId": svc, "environmentId": env, "input": {
    "healthcheckPath": "/", "healthcheckTimeout": 300,
    "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 10}})
q("""mutation($input: VolumeCreateInput!) { volumeCreate(input: $input) { id } }""",
  {"input": {"projectId": pid, "environmentId": env, "serviceId": svc, "mountPath": "/data"}})
domain = q("""mutation($input: ServiceDomainCreateInput!) { serviceDomainCreate(input: $input) { domain } }""",
  {"input": {"environmentId": env, "serviceId": svc, "targetPort": 6768}})["serviceDomainCreate"]["domain"]
q("""mutation($serviceId: String!, $environmentId: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }""",
  {"serviceId": svc, "environmentId": env})
print(f"PROJECT={pid}\nENV={env}\nSVC={svc}\nORIGIN=https://{domain}")
