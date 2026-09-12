/**
 * dsh-img2img-editor — host half.
 *
 * The editor is a browser-only surface: it reads the composer's image drafts and
 * writes the edited image back through the conversation service, so the host
 * contributes no service, tool, or route. This entry exists because every
 * bundle plugin needs a Loader entry and the package manifest points `main` at
 * a real module.
 */

/** Loader entry id for this package. */
export const name = 'dsh-img2img-editor'

/** No host service is required. */
export const inject: string[] = []

/** Intentionally empty: the panel lives entirely in `./client`. */
export function apply(): void {}
