// SPDX-License-Identifier: EUPL-1.2
// Retire in-flight OAuth/PAT saves before capturing the account generation.
function requestGithubCredential(github, entry, value) {
  if (!value || value.purpose !== 'github' || value.configuration && Object.keys(value.configuration).length) throw new Error('GitHub bruger sin faste modtager.');
  entry.cancelGithub();
  github.cancel();
  return entry.request({ purpose:'github', configuration:{ generation:github.generation } });
}
module.exports = { requestGithubCredential };
