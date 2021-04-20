# Changelog
All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
## [1.4.0] - 2021-04-20
### Added
- Add worker support when uploading sourcemaps. Defaults to 5 files
  being uploaded in parallel.

## [1.3.0] - 2021-04-13
### Added
- Add retry functionality for fetch requests via
  [fetch-retry](https://github.com/vercel/fetch-retry)
- Add a retry option that defaults to 3, with a max number of retries
  of 10.
- Add a warning if no assets will be uploaded. Uses console.info instead
  of process.stdout.write.
- Add a configurable `endpoint` to the constructor, defaults to
  `https://api.honeybadger.io/v1/source_maps`
- Add a check for auxiliary files for Webpack 5 compatibility
- Add Webpack 5 compatibility
- Make Webpack 4+ a peerDependency

### Fixed
- fetch separates response errors from network errors.
  400+ status codes are treated separately from actual network errors.
- Attempt to reduce `ECONNRESET` and `SOCKETTIMEOUT` errors by
  using `fetch-retry`

## [1.2.0] - 2019-12-18
### Changed
- [Requires Webpack 4.39] Use assetEmitted hook to mitigate `futureEmitAssets = true` -@qnighy (#122)

### Fixed
- Dependency & security updates
