const styles = {
  reset: "\x1b[0m",
  time: "\x1b[2m",
  info: "\x1b[36m",
  success: "\x1b[32m",
  warning: "\x1b[33m",
  error: "\x1b[1;31m",
  step: "\x1b[1;34m",
  debug: "\x1b[2m",
  worker: "\x1b[37;2m",
  wallet: "\x1b[95m",
};

const profileColors = [
  "\x1b[36m",
  "\x1b[32m",
  "\x1b[33m",
  "\x1b[35m",
  "\x1b[34m",
  "\x1b[96m",
  "\x1b[92m",
  "\x1b[93m",
  "\x1b[95m",
  "\x1b[94m",
];

const profileColorCache = new Map();

function hashLabel(label) {
  let hash = 0;
  for (let index = 0; index < label.length; index += 1) {
    hash = (hash * 31 + label.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function colorize(text, style) {
  if (!process.stdout.isTTY) {
    return text;
  }
  return `${style}${text}${styles.reset}`;
}

function getProfileColor(profileId) {
  if (!profileColorCache.has(profileId)) {
    const color = profileColors[hashLabel(profileId) % profileColors.length];
    profileColorCache.set(profileId, color);
  }
  return profileColorCache.get(profileId);
}

export function log(level, message, context = {}) {
  const ts = new Date().toLocaleTimeString("vi-VN", { hour12: false });
  const normalized = level.toUpperCase();
  const style =
    context.style ||
    (["OK", "DONE", "SUCCESS"].includes(normalized)
      ? "success"
      : normalized === "WARN"
        ? "warning"
        : normalized === "ERROR" || normalized === "FAILED"
          ? "error"
          : normalized === "STEP" || normalized === "TASK"
            ? "step"
            : "info");

  const parts = [
    colorize(ts, styles.time),
    colorize(`[${normalized}]`, styles[style] || styles.info),
  ];

  if (context.workerId) {
    parts.push(colorize(`[T:${context.workerId}]`, styles.worker));
  }

  if (context.profileId || context.profileName) {
    const label = context.profileName || context.profileId;
    parts.push(colorize(`[P:${label}]`, getProfileColor(String(label))));
  }

  if (context.wallet) {
    parts.push(colorize(`[W:${context.wallet}]`, styles.wallet));
  }

  if (context.step) {
    parts.push(colorize(`[STEP:${context.step}]`, styles.step));
  }

  parts.push(message);
  console.log(parts.join(" "));
}
