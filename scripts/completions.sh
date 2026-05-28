# AgentForge shell completions for bash and zsh
# Source this file: source scripts/completions.sh

_af_completions() {
  local cur="${COMP_WORDS[COMP_CWORD]}"
  local prev="${COMP_WORDS[COMP_CWORD-1]}"
  local commands="init add list show remove export import validate version auth use share pull test why snapshot fork rollback upgrade bench sync diff search preview graph lint bulk"

  if [[ $COMP_CWORD -eq 1 ]]; then
    COMPREPLY=($(compgen -W "$commands" -- "$cur"))
    return
  fi

  case "${COMP_WORDS[1]}" in
    add)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=($(compgen -W "agent skill prompt" -- "$cur"))
      elif [[ "$prev" == "--template" || "$prev" == "-t" ]]; then
        COMPREPLY=($(compgen -W "senior-dev docs-writer debugger code-reviewer" -- "$cur"))
      fi
      ;;
    export)
      if [[ "$prev" == "export" || "$prev" == "af" ]]; then
        COMPREPLY=($(compgen -W "claude_code codex opencode cursor windsurf all" -- "$cur"))
      elif [[ "$prev" == "--target" ]]; then
        COMPREPLY=($(compgen -W "claude_code codex opencode cursor windsurf all" -- "$cur"))
      fi
      ;;
    remove|show|preview|why|test|bench)
      if [[ -d .agentforge ]]; then
        local names=""
        for f in .agentforge/agents/*.yaml; do
          [[ -f "$f" ]] && names="$names $(basename "$f" .yaml)"
        done
        COMPREPLY=($(compgen -W "$names" -- "$cur"))
      fi
      ;;
    bulk)
      if [[ $COMP_CWORD -eq 2 ]]; then
        COMPREPLY=($(compgen -W "rename version" -- "$cur"))
      elif [[ "$prev" == "--filter" || "$prev" == "-f" ]]; then
        COMPREPLY=($(compgen -W "agent skill prompt" -- "$cur"))
      fi
      ;;
    use)
      if [[ -d .agentforge ]]; then
        local names=""
        for f in .agentforge/agents/*.yaml; do
          [[ -f "$f" ]] && names="$names $(basename "$f" .yaml)"
        done
        COMPREPLY=($(compgen -W "$names" -- "$cur"))
      fi
      ;;
    fork)
      if [[ -d .agentforge ]]; then
        local names=""
        for d in agents skills prompts; do
          for f in .agentforge/$d/*.yaml .agentforge/$d/*.md; do
            [[ -f "$f" ]] && names="$names $(basename "$f" .yaml | basename "$f" .md)"
          done
        done
        COMPREPLY=($(compgen -W "$names" -- "$cur"))
      fi
      ;;
    validate|lint)
      COMPREPLY=($(compgen -W "--fix --lint" -- "$cur"))
      ;;
    graph|search|list|diff|audit|snapshot|rollback|sync|import)
      # no specific completions needed
      ;;
    *)
      COMPREPLY=($(compgen -W "--help" -- "$cur"))
      ;;
  esac
}

# zsh compatibility
if [[ -n "$ZSH_VERSION" ]]; then
  autoload -U +X compinit && compinit
  compdef _af_completions af
else
  complete -F _af_completions af
fi
