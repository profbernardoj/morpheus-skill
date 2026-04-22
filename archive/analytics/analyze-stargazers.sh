#!/bin/bash
#
# Stargazer Engagement Analysis
# Analyzes GitHub users who starred EverClaw repositories
#
# Usage: ./analyze-stargazers.sh [username]
#

REPOS=(
  "profbernardoj/everclaw"
  "EverClaw/EverClaw"
  "profbernardoj/androidclaw.org"
  "profbernardoj/appleclaw.org"
  "profbernardoj/arbclaw.com"
  "profbernardoj/baseclaw.ai"
  "profbernardoj/bitcoinclaw.ai"
  "profbernardoj/bookingclaw.org"
  "profbernardoj/briefingclaw.com"
  "profbernardoj/deepseekclaw.org"
  "profbernardoj/emailclaw.org"
  "profbernardoj/ethereumclaw.com"
  "profbernardoj/familyclaw.org"
  "profbernardoj/familyofficeclaw.com"
  "profbernardoj/friendclaw.xyz"
  "profbernardoj/glmclaw.com"
  "profbernardoj/grokclaw.xyz"
  "profbernardoj/homeclaw.org"
  "profbernardoj/installopenclaw.xyz"
  "profbernardoj/investclaw.ai"
  "profbernardoj/kimiclaw.co"
  "profbernardoj/linuxclaw.com"
  "profbernardoj/llamaclaw.org"
  "profbernardoj/minimaxclaw.com"
  "profbernardoj/morpheusclaw.com"
  "profbernardoj/officeclaw.ai"
  "profbernardoj/solanaclaw.xyz"
  "profbernardoj/travelclaw.org"
  "profbernardoj/vcclaw.org"
  "profbernardoj/windowsclaw.org"
  "profbernardoj/openclaw"
  "SmartAgentProtocol/smartagent"
)

# Keywords for EverClaw/OpenClaw relevance
KEYWORDS="openclaw|everclaw|morpheus|agent|ai|llm|chatgpt|claude|gpt|decentralized|web3|crypto|blockchain|autonomous|automation|inference"

analyze_user() {
  local user=$1
  echo "=== Analyzing: $user ==="
  
  # Get user profile
  gh api "users/$user" -q '{login: .login, name: .name, bio: .bio, location: .location, company: .company, blog: .blog, twitter: .twitter_username, followers: .followers, public_repos: .public_repos}' 2>/dev/null
  
  # Get their repos (first 30)
  echo ""
  echo "Repositories:"
  gh api "users/$user/repos?per_page=30&sort=updated" -q '.[] | {name: .name, description: .description, language: .language, stars: .stargazers_count, updated: .updated_at}' 2>/dev/null | head -50
  
  # Check for relevant repos
  echo ""
  echo "Relevant to EverClaw:"
  gh api "users/$user/repos?per_page=100" -q ".[] | select(.description | test(\"$KEYWORDS\"; \"i\")) | {name: .name, description: .description}" 2>/dev/null | head -20
  
  echo ""
}

collect_all_stargazers() {
  echo "Collecting stargazers from ${#REPOS[@]} repositories..."
  
  > /tmp/all_stargazers.json
  
  for repo in "${REPOS[@]}"; do
    echo "Fetching: $repo"
    gh api "repos/$repo/stargazers" --paginate -q '.[] | {login: .login, repo: "'$repo'"}' 2>/dev/null >> /tmp/all_stargazers.json
  done
  
  # Count unique users
  unique=$(jq -r '.login' /tmp/all_stargazers.json 2>/dev/null | sort | uniq | wc -l | tr -d ' ')
  echo ""
  echo "Total unique stargazers: $unique"
  
  # Create summary by user
  jq -r '.login + "," + .repo' /tmp/all_stargazers.json 2>/dev/null | sort | awk -F',' '{users[$1] = users[$1] ? users[$1] + 1 : 1} END {for (u in users) print users[u] "," u}' | sort -rn > /tmp/stargazer_tiers.txt
  
  echo ""
  echo "=== Tier 1 (3+ repos starred) ==="
  awk -F',' '$1 >= 3 {print $2}' /tmp/stargazer_tiers.txt
  
  echo ""
  echo "=== Tier 2 (2 repos starred) ==="
  awk -F',' '$1 == 2 {print $2}' /tmp/stargazer_tiers.txt | head -20
  
  echo ""
  echo "Run 'analyze_user <username>' to analyze a specific stargazer"
}

# Main
if [ -n "$1" ]; then
  analyze_user "$1"
else
  collect_all_stargazers
fi