/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const semver = require('semver')
const keepachangelog = require('keepachangelog')

// eslint-disable-next-line no-undef
module.exports = {
  updateChangelog: false,
  formatCommitMessage: ({ version, _releaseType, _baseBranch }) => `Release v${version}`,
  formatPullRequestTitle: ({ version, _releaseType }) => `Release v${version}`,
  getNextVersion: ({ _revisionRange, _commitTitles, _commitBodies, currentVersion, dir }) => {
    const changelogFile = `${dir}/CHANGELOG.md`
    const content = fs.readFileSync(changelogFile, 'utf8')
    const changelog = keepachangelog.parse(content)
    return getNextVersion(changelog, currentVersion)
  },
  beforeCommitChanges: ({ nextVersion, _releaseType, _exec, dir }) => {
    const changelogFile = `${dir}/CHANGELOG.md`
    const content = fs.readFileSync(changelogFile, 'utf8')
    const changelog = keepachangelog.parse(content)
    changelog.addRelease(nextVersion)
    fs.writeFileSync(changelogFile, changelog.build(), 'utf8')
  },
  shouldPrepare: ({ nextVersion, commitNumbersPerType }) => {
    return !!nextVersion
  }
}


function getNextVersion(changelog, currentVersion, releaseTag = 'latest') {
  const parsedVersion = semver.parse(currentVersion)
  const upcomingRelease = changelog.getRelease('upcoming') || { version: 'upcoming' }

  let releaseType
  if (upcomingRelease.Changed?.length > 0) {
    releaseType = 'major'
  } else if (upcomingRelease.Added?.length > 0) {
    releaseType = 'minor'
  } else if (upcomingRelease.Fixed?.length > 0) {
    releaseType = 'patch'
  } else {
    return null
  }

  if (releaseTag !== 'latest') {
    if (parsedVersion.prerelease.length) {
      parsedVersion.inc('prerelease', releaseTag)
    } else {
      parsedVersion.inc(releaseType)
      parsedVersion.prerelease = [ releaseTag, 0 ]
      parsedVersion.format()
    }
  } else {
    parsedVersion.inc(releaseType)
  }

  return parsedVersion.version
}
