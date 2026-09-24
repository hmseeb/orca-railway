#!/usr/bin/env python3
"""Set name/description/icon, then publish. The slug is minted from NAME here, permanently."""
import pathlib, sys
sys.path.insert(0, str(pathlib.Path("~/.claude/skills/create-template-for-railway/scripts").expanduser()))
import rw  # noqa: E402
from repair import TEMPLATE_ID, WORKSPACE

NAME = sys.argv[1]
DESCRIPTION = "Orca ADE server: run Claude Code, Codex and more in parallel worktrees"
ICON = "https://raw.githubusercontent.com/stablyai/orca/98584332a31acc0c0d60115edf03486068a35987/resources/icon.png"
CATEGORY = "AI/ML"
README = (pathlib.Path(__file__).parent / "TEMPLATE_OVERVIEW.md").read_text()
assert len(DESCRIPTION) <= 75 and "\u2014" not in DESCRIPTION + README

rw.gql("mutation($id: String!, $input: TemplateUpsertSettingsInput!){ templateUpsertSettings(id:$id, input:$input){ id name } }",
       {"id": TEMPLATE_ID, "input": {"workspaceId": WORKSPACE, "name": NAME, "description": DESCRIPTION, "image": ICON}},
       internal=True)
out = rw.gql("mutation($id: String!, $input: TemplatePublishInput!){ templatePublish(id:$id, input:$input){ id code name status } }",
             {"id": TEMPLATE_ID, "input": {"category": CATEGORY, "description": DESCRIPTION,
                                           "readme": README, "workspaceId": WORKSPACE}})["templatePublish"]
print(f"{out['name']}  ->  https://railway.com/deploy/{out['code']}   ({out['status']})")
