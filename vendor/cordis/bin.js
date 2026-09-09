#!/usr/bin/env node

import { Context } from '@open-harness/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@open-harness/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@open-harness/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
