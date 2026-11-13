import type { HttpClient } from '@any-music/core'

import { getWorkbenchRuntime } from './workbench-runtime'

export const runtimeHttpClient: HttpClient = {
  request: (request) => getWorkbenchRuntime().http.request(request),
}
