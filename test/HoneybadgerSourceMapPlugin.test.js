/* eslint-env mocha */

import chai from 'chai'
import sinon from 'sinon'
import nock from 'nock'
import HoneybadgerSourceMapPlugin from '../src/HoneybadgerSourceMapPlugin'

const expect = chai.expect

describe('HoneybadgerSourceMapPlugin', function () {
  beforeEach(function () {
    this.compiler = {
      hooks: {
        afterEmit: {
          tapAsync: sinon.spy()
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
        assetsUrl: 'https://cdn.example.com/assets'
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
  })

  describe('apply', function () {
    it('should tap into "afterEmit" hook', function () {
      const { afterEmit } = this.compiler.hooks

      this.plugin.apply(this.compiler)

      expect(afterEmit.tapAsync.callCount).to.eq(1)

      const afterEmitArgs = afterEmit.tapAsync.getCall(0).args

      // Functions need to be compared by string equality.
      afterEmitArgs[1] = afterEmitArgs[1].toString()

      expect(afterEmitArgs).to.include.members([
        'HoneybadgerSourceMapPlugin',
        this.plugin.afterEmit.bind(this.plugin).toString()
      ])
    })

    it('should hook into "after-emit"', function () {
      this.compiler.hooks = null
      this.compiler.plugin = sinon.stub()
      this.plugin.apply(this.compiler)

      expect(this.compiler.plugin.callCount).to.eq(1)
      const compilerArgs = this.compiler.plugin.getCall(0).args
      compilerArgs[1] = compilerArgs[1].toString()

      expect(compilerArgs).to.include.members([
        'after-emit',
        this.plugin.afterEmit.bind(this.plugin).toString()
      ])
    })
  })

  describe('afterEmit', function () {
    afterEach(function () {
      sinon.reset()
    })

    it('should call uploadSourceMaps', function (done) {
      const compilation = {
        errors: [],
        warnings: []
      }

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake((_compilation, callback) => callback())
      this.plugin.afterEmit(compilation, () => {
        expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
        expect(compilation.errors.length).to.eq(0)
        expect(compilation.warnings.length).to.eq(0)
        done()
      })
    })

    it('should add upload warnings to compilation warnings, ' +
      'if ignoreErrors is true and silent is false', function (done) {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = true
      this.plugin.silent = false

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake((_comp, callback) => callback(new Error()))

      this.plugin.afterEmit(compilation, () => {
        expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
        expect(compilation.errors.length).to.eq(0)
        expect(compilation.warnings.length).to.eq(1)
        expect(compilation.warnings[0]).to.be.an.instanceof(Error)
        done()
      })
    })

    it('should not add upload errors to compilation warnings if silent is true', function (done) {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = true
      this.plugin.silent = true

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake((_comp, callback) => callback(new Error()))

      this.plugin.afterEmit(compilation, () => {
        expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
        expect(compilation.errors.length).to.eq(0)
        expect(compilation.warnings.length).to.eq(0)
        done()
      })
    })

    it('should add upload errors to compilation errors', function (done) {
      const compilation = {
        errors: [],
        warnings: []
      }
      this.plugin.ignoreErrors = false

      sinon.stub(this.plugin, 'uploadSourceMaps')
        .callsFake((_comp, callback) => callback(new Error()))

      this.plugin.afterEmit(compilation, () => {
        expect(this.plugin.uploadSourceMaps.callCount).to.eq(1)
        expect(compilation.warnings.length).to.eq(0)
        expect(compilation.errors.length).to.be.eq(1)
        expect(compilation.errors[0]).to.be.an.instanceof(Error)
        done()
      })
    })

    it('should add validation errors to compilation', function (done) {
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
        .callsFake((_comp, callback) => callback())

      this.plugin.afterEmit(compilation, () => {
        expect(this.plugin.uploadSourceMaps.callCount).to.eq(0)
        expect(compilation.errors.length).to.eq(1)
        done()
      })
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
        .callsFake((_comp, _chunk, callback) => callback())
    })

    afterEach(function () {
      sinon.restore()
    })

    it('should call uploadSourceMap for each chunk', function (done) {
      this.plugin.uploadSourceMaps(this.compilation, (err) => {
        if (err) {
          return done(err)
        }
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
        done()
      })
    })

    it('should call err-back if uploadSourceMap errors', function (done) {
      this.plugin.uploadSourceMap.restore()
      sinon.stub(this.plugin, 'uploadSourceMap')
        .callsFake((_comp, _chunk, callback) => callback(new Error()))
      this.plugin.uploadSourceMaps(this.compilation, (err, result) => {
        expect(err).to.be.an.instanceof(Error)
        expect(result).to.eq(undefined)
        done()
      })
    })
  })

  describe('uploadSourceMap', function () {
    beforeEach(function () {
      this.info = sinon.spy(console, 'info')
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

    it('should callback without err param if upload is success', function (done) {
      // FIXME/TODO test multipart form body ... it isn't really supported easily by nock
      nock('https://api.honeybadger.io')
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        if (err) {
          return done(err)
        }

        expect(this.info.calledWith('Uploaded vendor.5190.js.map to Honeybadger API')).to.eq(true)
        done()
      })
    })

    it('should not log upload to console if silent option is true', function (done) {
      nock('https://api.honeybadger.io')
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this
      this.plugin.silent = true
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        if (err) {
          return done(err)
        }
        expect(this.info.notCalled).to.eq(true)
        done()
      })
    })

    it('should log upload to console if silent option is false', function (done) {
      nock('https://api.honeybadger.io')
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .reply(201, JSON.stringify({ status: 'OK' }))

      const { compilation, chunk } = this
      this.plugin.silent = false
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        if (err) {
          return done(err)
        }
        expect(this.info.calledWith('Uploaded vendor.5190.js.map to Honeybadger API')).to.eq(true)
        done()
      })
    })

    it('should return error message if failure response includes message', function (done) {
      nock('https://api.honeybadger.io')
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .reply(422, JSON.stringify({ error: 'The "source_map" parameter is required' }))

      const { compilation, chunk } = this
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        expect(err).to.deep.include({
          message: 'failed to upload vendor.5190.js.map to Honeybadger API: The "source_map" parameter is required'
        })
        done()
      })
    })

    it('should handle error response with empty body', function (done) {
      nock('https://api.honeybadger.io') // eslint-disable-line no-unused-vars
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .reply(422, null)

      const { compilation, chunk } = this
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        expect(err.message).to.match(/failed to upload vendor\.5190.js\.map to Honeybadger API: [\w\s]+/)
        done()
      })
    })

    it('should handle HTTP request error', function (done) {
      nock('https://api.honeybadger.io') // eslint-disable-line no-unused-vars
        .filteringRequestBody(function (_body) { return '*' })
        .post('/v1/source_maps', '*')
        .replyWithError('something awful happened')

      const { compilation, chunk } = this
      this.plugin.uploadSourceMap(compilation, chunk, (err) => {
        expect(err).to.deep.include({
          message: 'failed to upload vendor.5190.js.map to Honeybadger API: something awful happened'
        })
        done()
      })
    })
  })
})
