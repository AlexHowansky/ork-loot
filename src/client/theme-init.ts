// Runs before first paint so the stored theme doesn't flash.
import { applyTheme, storedTheme } from "./theme.ts";

applyTheme(storedTheme());
