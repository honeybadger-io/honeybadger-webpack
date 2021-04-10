import { promises as fs } from 'fs'
import { join } from 'path'
import nodeFetch from 'node-fetch'
import fetchRetry from '@vercel/fetch-retry'
import VError from 'verror'
import find from 'lodash.find'
import reduce from 'lodash.reduce'
import FormData from 'form-data'
import { handleError, validateOptions } from './helpers'
import { ENDPOINT, DEPLOY_ENDPOINT, PLUGIN_NAME, MAX_RETRIES } from './constants'

const fetch = fetchRetry(nodeFetch)

/**
 * @typedef {Object} DeployObject
 * @property {?string} environment - production, development, staging, etc
 * @property {?string} repository - URL for repository IE: https://github.com/foo/bar
 * @property {?string} localUsername - The name of the user deploying. IE: Jane
 */

class HoneybadgerSourceMapPlugin {
  constructor ({
    apiKey,
    assetsUrl,
    endpoint = ENDPOINT,
    revision = 'master',
    silent = false,
    ignoreErrors = false,
    retries = 3,
    deploy = {}
  }) {
    this.apiKey = apiKey
    this.assetsUrl = assetsUrl
    this.endpoint = endpoint
    this.revision = revision
    this.silent = silent
    this.ignoreErrors = ignoreErrors
    this.emittedAssets = new Map()

    /** @type DeployObject */
    this.deploy = deploy;

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

    await this.sendDeployNotification()
  }

  apply (compiler) {
    compiler.hooks.afterEmit.tapPromise(PLUGIN_NAME, this.afterEmit.bind(this))
  }

  // eslint-disable-next-line class-methods-use-this
  getAssetPath (compilation, name) {
    return join(
      compilation.getPath(compilation.compiler.outputPath),
      name.split('?')[0]
    )
  }

  getSource (compilation, name) {
    const path = this.getAssetPath(compilation, name)
    return fs.readFile(path, { encoding: 'utf-8' })
  }

  getAssets (compilation) {
    const { chunks } = compilation.getStats().toJson()

    return reduce(chunks, (result, chunk) => {
      const sourceFile = find(chunk.files, file => /\.js$/.test(file))

      // Webpack 4 using chunk.files, Webpack 5 uses chunk.auxiliaryFiles
      // https://webpack.js.org/blog/2020-10-10-webpack-5-release/#stats
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

    let sourceMapSource
    let sourceFileSource

    try {
      sourceMapSource = await this.getSource(compilation, sourceMap)
      sourceFileSource = await this.getSource(compilation, sourceFile)
    } catch (err) {
      throw new VError(err, err.message)
    }

    const form = new FormData()
    form.append('api_key', this.apiKey)
    form.append('minified_url', this.getUrlToAsset(sourceFile))
    form.append('minified_file', sourceFileSource, {
      filename: sourceFile,
      contentType: 'application/javascript'
    })
    form.append('source_map', sourceMapSource, {
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
        console.info(this.noAssetsFoundMessage)
      }

      return
    }

    console.info('\n')

    return Promise.all(
      assets.map(asset => this.uploadSourceMap(compilation, asset))
    )
  }

  async sendDeployNotification () {
    const { environment, localUsername, repository } = this.deploy
    const { apiKey, revision } = this

    const isNull = (param) => param == null

    // If any of the keys are null, dont bother sending a fetch request
    if ([apiKey, revision, environment, localUsername, repository].some(isNull)) {
      return
    }

    const form = new FormData()
    form.append('api_key', apiKey)
    form.append('revision', revision)
    form.append('repository', repository)
    form.append('local_username', localUsername)
    form.append('environment', environment)

    const errorMessage = 'Unable to send deploy notification to Honeybadger API.'
    let res

    try {
      res = await fetch(DEPLOY_ENDPOINT, {
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
      if (!this.ignoreErrors) {
        throw new VError(err, errorMessage)
      }
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

      if (!this.ignoreErrors) {
        throw new Error(`${errorMessage}: ${details}`)
      }
    }

    if (!this.silent) {
      console.info('Successfully sent deploy notification to Honeybadger API.')
    }
  }

  get noAssetsFoundMessage () {
    return '\nHoneybadger could not find any sourcemaps. Nothing will be uploaded.'
  }
}

module.exports = HoneybadgerSourceMapPlugin
