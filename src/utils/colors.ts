const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

export const colors = C;

export function colorType(type: string): string {
  switch (type) {
    case "agent": return `${C.blue}agent${C.reset}`;
    case "skill": return `${C.green}skill${C.reset}`;
    case "prompt": return `${C.yellow}prompt${C.reset}`;
    default: return type;
  }
}

export function colorName(name: string, type: string): string {
  switch (type) {
    case "agent": return `${C.blue}${name}${C.reset}`;
    case "skill": return `${C.green}${name}${C.reset}`;
    case "prompt": return `${C.yellow}${name}${C.reset}`;
    default: return name;
  }
}

export function colorCount(n: number, type: string): string {
  const label = type === "agent" ? `a:${n}` : type === "skill" ? `s:${n}` : `p:${n}`;
  switch (type) {
    case "agent": return `${C.blue}${label}${C.reset}`;
    case "skill": return `${C.green}${label}${C.reset}`;
    case "prompt": return `${C.yellow}${label}${C.reset}`;
    default: return label;
  }
}

export function separator(label: string, width: number): string {
  const line = "─".repeat(Math.max(0, width - label.length - 4));
  return `${C.dim}${line} ${label} ${line}${C.reset}`;
}

export function dimmed(text: string): string {
  return `${C.dim}${text}${C.reset}`;
}
