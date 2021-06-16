/* eslint-env mocha */

import HoneybadgerSourceMapPlugin from '../src/HoneybadgerSourceMapPlugin'
import webpack from 'webpack'
import chai from 'chai'
import path from 'path'

const expect = chai.expect

const ASSETS_URL = 'https://cdn.example.com/assets';

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

// Mock console.info so we can assert on Honeybadger plugin output
const consoleOutput = [];
const originalConsoleInfo = console.info.bind(console);
console.info = (thing) => {
  consoleOutput.push(thing)
  originalConsoleInfo(thing)
}

it('it successfully uploads source maps', function(done) {
  this.timeout(4000)

  webpack(webpackConfig, (err, stats) => {
    expect(err).to.be.null

    const info = stats.toJson('errors-warnings')
    expect(info.errors.length).to.equal(0)
    expect(info.warnings.length).to.equal(0)
    expect(consoleOutput).to.contain('Uploaded main.js.map to Honeybadger API')

    console.info = originalConsoleInfo
    done()
  })
})
