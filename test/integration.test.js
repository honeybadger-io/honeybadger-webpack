/* eslint-env mocha */

import HoneybadgerSourceMapPlugin from '../src/HoneybadgerSourceMapPlugin'
import webpack from 'webpack'
import chai from 'chai'
import path from 'path'
import nock from 'nock'
import sinon from 'sinon'

const expect = chai.expect

const ASSETS_URL = 'https://cdn.example.com/assets'

const webpackConfig = {
  mode: 'production',
  entry: path.join(__dirname, 'fixtures/uncompiled.js'),
  output: {
    path: path.join(__dirname, '../tmp/')
  },
  // Enable source maps
  devtool: 'source-map',
  // Otherwise the stats object will be very big
  stats: 'errors-warnings',
  plugins: [new HoneybadgerSourceMapPlugin({
    apiKey: 'abc123',
    retries: 0,
    assetsUrl: ASSETS_URL,
    revision: 'master'
  })]
}

const consoleInfo = sinon.stub(console, 'info')

const TEST_ENDPOINT = 'https://api.honeybadger.io'
const SOURCEMAP_PATH = '/v1/source_maps'

it('it successfully uploads source maps', function (done) {
  nock(TEST_ENDPOINT)
    .post(SOURCEMAP_PATH)
    .reply(200, JSON.stringify({ status: 'OK' }))

  webpack(webpackConfig, (err, stats) => {
    expect(err).to.eq(null)

    const info = stats.toJson('errors-warnings')
    expect(info.errors.length).to.equal(0)
    expect(info.warnings.length).to.equal(0)

    expect(consoleInfo.calledWith('Uploaded main.js.map to Honeybadger API')).to.eq(true)
    done()
  })
})
