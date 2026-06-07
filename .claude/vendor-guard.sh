#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
# VENDOR BOUNDARY GUARD — Claude Code PreToolCall hook
# Fires before every Edit / Write / MultiEdit tool call.
# Reads the file path from CLAUDE_TOOL_INPUT (JSON) and prints a
# clear vendor banner so Claude always knows which vendor's code
# it is about to touch.
#
# Exit 0  → warning only, edit is allowed to proceed
# Exit 2  → Claude sees the message as a hard block and must stop
# ─────────────────────────────────────────────────────────────────

TOOL_INPUT="${CLAUDE_TOOL_INPUT:-}"

# Extract file_path from the JSON input
FILE_PATH=$(printf '%s' "$TOOL_INPUT" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('file_path', d.get('path', '')))" 2>/dev/null)

[[ -z "$FILE_PATH" ]] && exit 0   # not a file-editing tool, pass through

# ── Determine vendor from path ───────────────────────────────────
if [[ "$FILE_PATH" == *"/_lk_tax/"* ]]; then
  VENDOR="WHEEL MART"
  COLOR="\033[1;34m"   # blue
  FOLDER="_lk_tax"
  OTHER_FOLDER="_standard"
  OTHER_VENDOR="Sakura Auto"
elif [[ "$FILE_PATH" == *"/_standard/"* ]]; then
  VENDOR="Sakura Auto"
  COLOR="\033[1;33m"   # yellow
  FOLDER="_standard"
  OTHER_FOLDER="_lk_tax"
  OTHER_VENDOR="WHEEL MART"
else
  # Shared or non-vendor file — no restriction, just note if _shared
  if [[ "$FILE_PATH" == *"/_shared/"* ]]; then
    echo -e "\033[1;32m[VENDOR GUARD]\033[0m Shared file — change affects BOTH vendors: $FILE_PATH"
  fi
  exit 0
fi

RESET="\033[0m"
BOLD="\033[1m"
RED="\033[1;31m"

echo ""
echo -e "${COLOR}╔══════════════════════════════════════════════════════════╗${RESET}"
echo -e "${COLOR}║  VENDOR BOUNDARY GUARD                                  ║${RESET}"
echo -e "${COLOR}╚══════════════════════════════════════════════════════════╝${RESET}"
echo -e "  ${BOLD}File   :${RESET} $FILE_PATH"
echo -e "  ${BOLD}Vendor :${RESET} ${COLOR}${VENDOR}${RESET}  (folder: ${FOLDER}/)"
echo -e "  ${RED}⚠  This file belongs to ${VENDOR} ONLY.${RESET}"
echo -e "     If the current task is for ${OTHER_VENDOR}, STOP immediately."
echo -e "     ${OTHER_VENDOR} code lives in ${OTHER_FOLDER}/ — verify before proceeding."
echo ""

exit 0
