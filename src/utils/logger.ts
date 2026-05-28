export const consola = {
  log: (msg: string) => console.log(msg),
  info: (msg: string) => console.log(`ℹ ${msg}`),
  success: (msg: string) => console.log(`✔ ${msg}`),
  warn: (msg: string) => console.log(`⚠ ${msg}`),
  error: (msg: string) => console.error(`✖ ${msg}`),
  debug: (msg: string) => {
    if (process.env.DEBUG) console.debug(`🔍 ${msg}`);
  },
};
