#!/usr/bin/env python3
"""Deploy the template into a fresh project exactly as the Deploy button does."""
import json, pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402
from repair import TEMPLATE_ID, WORKSPACE

config = rw.gql("query($id:String!){ template(id:$id){ serializedConfig } }", {"id": TEMPLATE_ID})["template"]["serializedConfig"]
out = rw.gql("""mutation($input: TemplateDeployV2Input!){ templateDeployV2(input:$input){ projectId workflowId } }""",
             {"input": {"templateId": TEMPLATE_ID, "workspaceId": WORKSPACE, "serializedConfig": config}})
print(json.dumps(out, indent=1))
