// Shell completion scripts for `wsm`. Both scripts shell out to
// `wsm list --names-only` at completion time rather than embedding
// workspace names statically, so completions stay in sync with
// config.yaml without needing the script to be regenerated.

export function bashCompletionScript(commands: string[]): string {
  const commandList = commands.join(" ");
  return `_wsm_completions() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${commandList}" -- "\${cur}") )
    return
  fi

  case "\${prev}" in
    open|close)
      COMPREPLY=( $(compgen -W "$(wsm list --names-only 2>/dev/null)" -- "\${cur}") )
      ;;
  esac
}
complete -F _wsm_completions wsm
`;
}

export function zshCompletionScript(commands: string[]): string {
  const commandList = commands.map((c) => `'${c}'`).join(" ");
  return `#compdef wsm

_wsm() {
  local -a subcommands
  subcommands=(${commandList})

  if (( CURRENT == 2 )); then
    _describe 'command' subcommands
    return
  fi

  case "\${words[2]}" in
    open|close)
      local -a workspaces
      workspaces=(\${(f)"$(wsm list --names-only 2>/dev/null)"})
      _describe 'workspace' workspaces
      ;;
  esac
}

# compdef only exists once \`autoload -Uz compinit && compinit\` has run.
# Without that guard this errors with "command not found: compdef" on any
# zsh setup that hasn't initialized the completion system yet.
if (( \$+functions[compdef] )); then
  compdef _wsm wsm
else
  print -u2 "wsm: zsh completion needs 'autoload -Uz compinit && compinit' run first (add it to your .zshrc before this line)."
fi
`;
}
