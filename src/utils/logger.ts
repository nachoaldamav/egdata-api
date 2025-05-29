import { createConsola, LogLevels } from "consola";

export const consola = createConsola({
  formatOptions: {
    colors: true,
    dateTime: true,
  },
  level: LogLevels.info,
});
