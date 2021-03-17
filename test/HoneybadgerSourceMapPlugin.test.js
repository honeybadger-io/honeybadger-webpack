/* eslint-env mocha */

import chai from 'chai'
import sinon from 'sinon'
import nock from 'nock'
import HoneybadgerSourceMapPlugin from '../src/HoneybadgerSourceMapPlugin'
import { ENDPOINT, MAX_RETRIES, PLUGIN_NAME } from '../src/constants'

const expect = chai.expect

const TEST_ENDPOINT = 'https://api.honeybadger.io'
const SOURCEMAP_PATH = '/v1/source_maps'

describe(PLUGIN_NAME, function () {
  beforeEach(function () {
    this.compiler = {
      hooks: {
        afterEmit: {
          tapPromise: sinon.spy()
        }
      }
    }

    this.options = {
      apiKey: 'abcd1234',
      assetsUrl: 'https://cdn.example.com/assets'
    }

    this.plugin = new HoneybadgerSourceMapPlugin(this.options)
  })

  describe('constructor', function () {
    it('should return an instance', function () {
      expect(this.plugin).to.be.an.instanceof(HoneybadgerSourceMapPlugin)
    })

    it('should set options', function () {
      const options = Object.assign({}, this.options, {
        apiKey: 'other-api-key',
        assetsUrl: 'https://cdn.example.com/assets',
        endpoint: 'https://my-random-endpoint.com'
      })
      const plugin = new HoneybadgerSourceMapPlugin(options)
      expect(plugin).to.include(options)
    })

    it('should default silent to false', function () {
      expect(this.plugin).to.include({ silent: false })
    })

    it('should default revision to "master"', function () {
      expect(this.plugin).to.include({ revision: 'master' })
    })

    it('should default retries to 3', function () {
      expect(this.plugin).to.include({ retries: 3 })
    })

    it('should default endpoint to https://api.honeybadger.io/v1/source_maps', function () {
      expect(this.plugin).to.include({ endpoint: ENDPOINT })
    })

    it('should scale back any retries > 10', function () {
      const options = { ...this.options, retries: 40 }
      const plugin = new HoneybadgerSourceMapPlugin(options)
      expect(plugin).to.include({ retries: MAX_RETRIES })
    })

    it('should allow users to set retries to 0', function () {
      const options = { ...this.options, retries: 0 }
      const plugin = new HoneybadgerSourceMapPlugin(options)
      expect(plugin).to.include({ retries: 0 })
    })
  })

  describe('apply', function () {
    it('should hook into "after-emit"', function () {
      this.compiler.plugin = sinon.stub()
      this.plugin.apply(this.compiler)

      const tapPromise = this.compiler.hooks.afterEmit.tapPromise
      expect(tapPromise.callCount).to.eq(1)

      const compilerArgs = tapPromise.getCall(0).args
      compilerArgs[1] = compilerArgs[1].toString()

      expect(compilerArgs).to.include.members([
        PLUGIN_NAME,
        compilerArgs[1]
      ])
    })
  })

  describe('afterEmit', function () {
    afterEach(function () {
      sinon.reset()
    })

    it('should call uploadSourceMaps', async function () {
      const compilation = {
        errors: [],
        warnings: []
      }

      sinon.stub(this.plugin, 'uploadSourceMaps')

      await this.plugin.afterEmit(compilation)

      expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
      expect(compilation.errors.length).to.eq(0)
      expect(compilation.warnings.length).to.eq(0)
    })

    it('should add upload warnings to compilation warnings, ' +
      'if ignoreErrors is true and silent is false', async function () {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = true
      this.plugin.silent = false

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake(() => { throw new Error() })

      await this.plugin.afterEmit(compilation)

      expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
      expect(compilation.errors.length).to.eq(0)
      expect(compilation.warnings.length).to.eq(1)
      expect(compilation.warnings[0]).to.be.an.instanceof(Error)
    })

    it('should not add upload errors to compilation warnings if silent is true', async function () {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = true
      this.plugin.silent = true

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake(() => { throw new Error() })

      await this.plugin.afterEmit(compilation)

      expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
      expect(compilation.errors.length).to.eq(0)
      expect(compilation.warnings.length).to.eq(0)
    })

    it('should add upload errors to compilation errors', async function () {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = false

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake(() => { throw new Error() })

      await this.plugin.afterEmit(compilation)

      expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
      expect(compilation.warnings.length).to.eq(0)
      expect(compilation.errors.length).to.be.eq(1)
      expect(compilation.errors[0]).to.be.an.instanceof(Error)
    })

    it('should add validation errors to compilation', async function () {
      const compilation = {
        errors: [],
        warnings: [],
        getStats: () => ({
          toJson: () => ({ chunks: this.chunks })
        })
      }

      this.plugin = new HoneybadgerSourceMapPlugin({
        revision: 'fab5a8727c70647dcc539318b5b3e9b0cb8ae17b',
        assetsUrl: 'https://cdn.example.com/assets'
      })

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake(() => {})

      await this.plugin.afterEmit(compilation)

      expect(this.plugin.uploadSourceMaps.callCount).to.eq(0)
      expect(compilation.errors.length).to.eq(1)
    })
  })

  describe('getAssets', function () {
    beforeEach(function () {
      this.chunks = [
        {
          id: 0,
          names: ['app'],
          files: ['app.81c1.js', 'app.81c1.js.map']
        }
      ]
      this.compilation = {
        getStats: () => ({
          toJson: () => ({ chunks: this.chunks })
        })
      }
    })

    it('should return an array of js, sourcemap tuples', function () {
      const assets = this.plugin.getAssets(this.compilation)
      expect(assets).to.deep.eq([
        { sourceFile: 'app.81c1.js', sourceMap: 'app.81c1.js.map' }
      ])
    })

    it('should ignore chunks that do not have a sourcemap asset', function () {
      this.chunks = [
        {
          id: 0,
          names: ['app'],
          files: ['app.81c1.js', 'app.81c1.js.map']
        }
      ]
      const assets = this.plugin.getAssets(this.compilation)
      expect(assets).to.deep.eq([
        { sourceFile: 'app.81c1.js', sourceMap: 'app.81c1.js.map' }
      ])
    })

    it('should get the source map files from auxiliaryFiles', function () {
      this.chunks = [
        {
          id: 0,
          names: ['vendor'],
          files: ['vendor.5190.js'],
          auxiliaryFiles: ['vendor.5190.js.map']
        }
      ]

      const assets = this.plugin.getAssets(this.compilation)
      expect(assets).to.deep.eq([
        { sourceFile: 'vendor.5190.js', sourceMap: 'vendor.5190.js.map' }
      ])
    })
  })

  describe('uploadSourceMaps', function () {
    beforeEach(function () {
      this.compilation = { name: 'test', errors: [] }
      this.assets = [
        { sourceFile: 'vendor.5190.js', sourceMap: 'vendor.5190.js.map' },
        { sourceFile: 'app.81c1.js', sourceMap: 'app.81c1.js.map' }
      ]
      sinon.stub(this.plugin, 'getAssets').returns(this.assets)
      sinon.stub(this.plugin, 'uploadSourceMap')
        .callsFake(() => {})
    })

    afterEach(function () {
      sinon.restore()
    })

    it('should call uploadSourceMap for each chunk', async function () {
      await this.plugin.uploadSourceMaps(this.compilation)

      expect(this.plugin.getAssets.callCount).to.eq(1)
      expect(this.compilation.errors.length).to.eq(0)
      expect(this.plugin.uploadSourceMap.callCount).to.eq(2)

      expect(this.plugin.uploadSourceMap.getCall(0).args[0])
        .to.deep.eq({ name: 'test', errors: [] })
      expect(this.plugin.uploadSourceMap.getCall(0).args[1])
        .to.deep.eq({ sourceFile: 'vendor.5190.js', sourceMap: 'vendor.5190.js.map' })

      expect(this.plugin.uploadSourceMap.getCall(1).args[0])
        .to.deep.eq({ name: 'test', errors: [] })
      expect(this.plugin.uploadSourceMap.getCall(1).args[1])
        .to.deep.eq({ sourceFile: 'app.81c1.js', sourceMap: 'app.81c1.js.map' })
    })

    it('should throw an error if the uploadSourceMap function returns an error', function () {
      this.plugin.uploadSourceMap.restore()

      const error = new Error()
      sinon.stub(this.plugin, 'uploadSourceMap')
        .callsFake(() => {})
        .rejects(error)

      // Chai doesnt properly async / await rejections, so we gotta work around it
      // with a...Promise ?!
      this.plugin.uploadSourceMaps(this.compilation)
        .catch((err) => expect(err).to.eq(error))
    })

    context('If no sourcemaps are found', function () {
      it('Should warn a user if silent is false', async function () {
        sinon.stub(process.stdout, 'write')
        this.plugin.getAssets.restore()
        sinon.stub(this.plugin, 'getAssets').returns([])

        nock(TEST_ENDPOINT)
          .filteringRequestBody(function (_body) { return '*' })
          .post(SOURCEMAP_PATH, '*')
          .reply(200, JSON.stringify({ status: 'OK' }))

        const { compilation } = this
        this.plugin.silent = false

        await this.plugin.uploadSourceMaps(compilation)

        expect(process.stdout.write.calledWith('No assets found. Nothing will be uploaded.')).to.eq(true)

        // manually called because we overwrite stdout
        sinon.restore()
      })

      it('Should not warn a user if silent is true', async function () {
        sinon.stub(process.stdout, 'write')
        this.plugin.getAssets.restore()
        sinon.stub(this.plugin, 'getAssets').returns([])

        nock(TEST_ENDPOINT)
          .filteringRequestBody(function (_body) { return '*' })
          .post(SOURCEMAP_PATH, '*')
          .reply(200, JSON.stringify({ status: 'OK' }))

        const { compilation } = this
        this.plugin.silent = true

        await this.plugin.uploadSourceMaps(compilation)

        expect(process.stdout.write.notCalled).to.eq(true)

        // manually called because we overwrite stdout
        sinon.restore()
      })
    })
  })

  describe('uploadSourceMap', function () {
    beforeEach(function () {
      this.info = sinon.stub(console, 'info')
      this.compilation = {
        assets: {
          'vendor.5190.js': { source: () => '/**/' },
          'vendor.5190.js.map': { source: () => '{"version":3,"file":"vendor.5190.js","sources":["vendor.js"],"names":[],mappings:""}' },
          'app.81c1.js': { source: () => '/**/' },
          'app.81c1.js.map': { source: () => '{"version":3,"file":"app.81c1.js","sources":["app.js"],"names":[],mappings:""}' }
        },
        errors: []
      }

      this.chunk = {
        sourceFile: 'vendor.5190.js',
        sourceMap: 'vendor.5190.js.map'
      }
    })

    afterEach(function () {
      sinon.restore()
    })

    it('should callback without err param if upload is success', async function () {
      // FIXME/TODO test multipart form body ... it isn't really supported easily by nock
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this

      await this.plugin.uploadSourceMap(compilation, chunk)

      expect(console.info.calledWith('Uploaded vendor.5190.js.map to Honeybadger API')).to.eq(true)
    })

    it('should not log upload to console if silent option is true', async function () {
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this
      this.plugin.silent = true

      await this.plugin.uploadSourceMap(compilation, chunk)

      expect(this.info.notCalled).to.eq(true)
    })

    it('should log upload to console if silent option is false', async function () {
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this
      this.plugin.silent = false

      await this.plugin.uploadSourceMap(compilation, chunk)

      expect(this.info.calledWith('Uploaded vendor.5190.js.map to Honeybadger API')).to.eq(true)
    })

    it('should return error message if failure response includes message', function () {
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(
          422,
          JSON.stringify({ error: 'The "source_map" parameter is required' })
        )

      const { compilation, chunk } = this

      this.plugin.uploadSourceMap(compilation, chunk).catch((err) => {
        expect(err).to.deep.include({
          message: 'failed to upload vendor.5190.js.map to Honeybadger API: The "source_map" parameter is required'
        })
      })
    })

    it('should handle error response with empty body', function () {
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(422, null)

      const { compilation, chunk } = this

      this.plugin.uploadSourceMap(compilation, chunk).catch((err) => {
        expect(err.message).to.match(/failed to upload vendor\.5190.js\.map to Honeybadger API: [\w\s]+/)
      })
    })

    it('should handle HTTP request error', function () {
      nock(TEST_ENDPOINT)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .replyWithError('something awful happened')

      const { compilation, chunk } = this

      this.plugin.uploadSourceMap(compilation, chunk).catch((err) => {
        expect(err).to.deep.include({
          message: 'failed to upload vendor.5190.js.map to Honeybadger API: something awful happened'
        })
      })
    })

    it('should make a request to a configured endpoint', async function () {
      const endpoint = 'https://my-special-endpoint'
      const plugin = new HoneybadgerSourceMapPlugin({ ...this.options, endpoint: `${endpoint}${SOURCEMAP_PATH}` })
      nock(endpoint)
        .filteringRequestBody(function (_body) { return '*' })
        .post(SOURCEMAP_PATH, '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this

      await plugin.uploadSourceMap(compilation, chunk)
      expect(this.info.calledWith('Uploaded vendor.5190.js.map to Honeybadger API')).to.eq(true)
    })

    // TODO: Nock doesnt play nicely with fetchRetry so unfortunately, it doesnt appear possible
    // to mock the functionality short of having a server listen for responses.
    // We could rewrite add MSW, but not sure its worth the hassle considering we're
    // essentially testing the package
  })
})
