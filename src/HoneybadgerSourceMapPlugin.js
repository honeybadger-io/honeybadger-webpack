import nodeFetch from 'node-fetch'
import fetchRetry from '@vercel/fetch-retry'
import VError from 'verror'
import find from 'lodash.find'
import reduce from 'lodash.reduce'
import FormData from 'form-data'
import { handleError, validateOptions } from './helpers'
import { ENDPOINT, PLUGIN_NAME, MAX_RETRIES } from './constants'

const fetch = fetchRetry(nodeFetch)

class HoneybadgerSourceMapPlugin {
  constructor ({
    apiKey,
    assetsUrl,
    endpoint = ENDPOINT,
    revision = 'master',
    silent = false,
    ignoreErrors = false,
    retries = 3
  }) {
    this.apiKey = apiKey
    this.assetsUrl = assetsUrl
    this.endpoint = endpoint
    this.revision = revision
    this.silent = silent
    this.ignoreErrors = ignoreErrors
    this.emittedAssets = new Map()

    this.retries = retries

    if (this.retries > MAX_RETRIES) {
      this.retries = 10
    }
  }

  async afterEmit (compilation) {
    const errors = validateOptions(this)

    if (errors) {
      compilation.errors.push(...handleError(errors))
      return
    }

    try {
      await this.uploadSourceMaps(compilation)
    } catch (err) {
      if (!this.ignoreErrors) {
        compilation.errors.push(...handleError(err))
      } else if (!this.silent) {
        compilation.warnings.push(...handleError(err))
      }
    }
  }

  apply (compiler) {
    compiler.hooks.afterEmit.tapPromise(PLUGIN_NAME, this.afterEmit.bind(this))
  }

  getAssets (compilation) {
    const { chunks } = compilation.getStats().toJson()

    return reduce(chunks, (result, chunk) => {
      const sourceFile = find(chunk.files, file => /\.js$/.test(file))

      // webpack 5 stores source maps in `chunk.auxiliaryFiles` while webpack 4
      // stores them in `chunk.files`. This allows both webpack versions to work
      // with this plugin.
      const sourceMap = (chunk.auxiliaryFiles || chunk.files).find(file =>
        /\.js\.map$/.test(file)
      )

      if (!sourceFile || !sourceMap) {
        return result
      }

      return [
        ...result,
        { sourceFile, sourceMap }
      ]
    }, [])
  }

  getUrlToAsset (sourceFile) {
    if (typeof sourceFile === 'string') {
      const sep = this.assetsUrl.endsWith('/') ? '' : '/'
      return `${this.assetsUrl}${sep}${sourceFile}`
    }
    return this.assetsUrl(sourceFile)
  }

  async uploadSourceMap (compilation, { sourceFile, sourceMap }) {
    const errorMessage = `failed to upload ${sourceMap} to Honeybadger API`
    // This should be looked at to use this instead:
    // https://github.com/thredup/rollbar-sourcemap-webpack-plugin/blob/master/src/RollbarSourceMapPlugin.js#L122

    const form = new FormData()
    form.append('api_key', this.apiKey)
    form.append('minified_url', this.getUrlToAsset(sourceFile))
    form.append('minified_file', (this.emittedAssets.get(sourceFile) || compilation.assets[sourceFile].source()), {
      filename: sourceFile,
      contentType: 'application/javascript'
    })
    form.append('source_map', (this.emittedAssets.get(sourceMap) || compilation.assets[sourceMap].source()), {
      filename: sourceMap,
      contentType: 'application/octet-stream'
    })
    form.append('revision', this.revision)

    let res
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        body: form,
        redirect: 'follow',
        opts: {
          retries: this.retries,
          // Max timeout between retries, in milliseconds
          maxTimeout: 1000
        }
      })
    } catch (err) {
      // network / operational errors. Does not include 404 / 500 errors
      throw new VError(err, errorMessage)
    }

    // >= 400 responses
    if (!res.ok) {
      // Attempt to parse error details from response
      let details
      try {
        const body = await res.json()

        if (body && body.error) {
          details = body.error
        } else {
          details = `${res.status} - ${res.statusText}`
        }
      } catch (parseErr) {
        details = `${res.status} - ${res.statusText}`
      }

      throw new Error(`${errorMessage}: ${details}`)
    }

    // Success
    if (!this.silent) {
      // eslint-disable-next-line no-console
      console.info(`Uploaded ${sourceMap} to Honeybadger API`)
    }
  }

  uploadSourceMaps (compilation) {
    const assets = this.getAssets(compilation)

    if (assets.length <= 0) {
      // We should probably tell people they're not uploading assets.
      // this is also an open issue on Rollbar sourcemap plugin
      // https://github.com/thredup/rollbar-sourcemap-webpack-plugin/issues/39
      if (!this.silent) {
        process.stdout.write('No assets found. Nothing will be uploaded.')
      }

      return
    }

    process.stdout.write('\n')

    return Promise.all(
      assets.map(asset => this.uploadSourceMap(compilation, asset))
    )
  }
}

module.exports = HoneybadgerSourceMapPlugin
