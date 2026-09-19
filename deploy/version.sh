# Ensure executable permissions on Unix/Linux:
# chmod +x deploy/version.sh
# # On Windows, Git Bash handles this automatically

set -euo pipefail

VERSION_FILE="package.json"
RELEASE_BRANCH="main"

# Get current version from package.json
get_version() {
    grep -o '"version": "[^"]*"' "$VERSION_FILE" | cut -d'"' -f4
}

# Bump version (semantic versioning)
bump_version() {
    local part=$1  # major, minor, patch
    
    if [[ -z "$part" ]]; then
        part="patch"
    fi
    
    case $part in
        major)
            echo "🔴 Bumping major version..."
            ;;
        minor)
            echo "🟡 Bumping minor version..."
            ;;
        patch)
            echo "🟢 Bumping patch version..."
            ;;
        *)
            echo "❌ Invalid part: $part. Use: major, minor, or patch"
            exit 1
            ;;
    esac
    
    # Read current version and bump it
    read -r -d '' current_version < <(get_version && printf '\0')
    IFS='.' read -r -a parts <<< "$current_version"
    
    case $part in
        major)
            parts[0]=$((parts[0] + 1))
            parts[1]=0
            parts[2]=0
            ;;
        minor)
            parts[1]=$((parts[1] + 1))
            parts[2]=0
            ;;
        patch)
            parts[2]=$((parts[2] + 1))
            ;;
    esac
    
    new_version="${parts[0]}.${parts[1]}.${parts[2]}"
    
    # Update package.json
    sed -i "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" "$VERSION_FILE"
    
    echo "✅ Version bumped from $current_version to $new_version"
    echo ""
    git diff "$VERSION_FILE"
    return 0
}

# Create git tag
create_tag() {
    local version=$(get_version)
    local tag="v${version}"
    
    echo "🏷️  Creating tag: $tag"
    
    # Check if tag already exists
    if git rev-parse "$tag" >/dev/null 2>&1; then
        echo "⚠️  Tag $tag already exists!"
        return 1
    fi
    
    # Commit any pending changes first
    if ! git diff --quiet >/dev/null 2>&1; then
        echo "📦 Committing changes before tagging..."
        git add -A
        git commit -m "chore: version bump to ${version}"
    fi
    
    # Create annotated tag with release message
    git tag -a "$tag" -m "Release v${version}"
    
    echo "✅ Tag created successfully"
    echo ""
    echo "📋 Recent changes:"
    git log --oneline HEAD~5..HEAD
    echo ""
    echo "💡 Next step: View at https://github.com/ShinozakiYuurei/YuuMovie/releases"
    return 0
}

# Push version to remote
push_version() {
    echo "🚀 Pushing version to remote..."
    git push origin "$RELEASE_BRANCH" --tags
    echo "✅ Version pushed successfully"
}

# Show version info
show_info() {
    local current=$(get_version)
    echo "📦 Current version: v$current"
    echo ""
    echo "Recent commits:"
    git log --oneline -5
    echo ""
    echo "Available tags:"
    git tag -l | tail -10
}

# Main logic
case "${1:-help}" in
    bump)
        bump_version "${2:-patch}"
        ;;
    show)
        show_info
        ;;
    tag)
        create_tag
        ;;
    push)
        push_version
        ;;
    release)
        # Full release workflow: bump → commit → tag → push
        echo "🎯 Starting full release process..."
        
        # Step 1: Bump patch version automatically
        bump_version patch
        
        # Step 2: Tag
        create_tag || exit 1
        
        # Step 3: Push
        push_version
        
        echo ""
        echo "✅ Release complete! New version: v$(get_version)"
        ;;
    help|--help|-h)
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  bump [major|minor|patch]   Bump version (default: patch)"
        echo "  show                       Show current version and recent activity"
        echo "  tag                        Create a git tag for current version"
        echo "  push                       Push version to remote"
        echo "  release                    Complete release workflow (recommended)"
        echo "  help                       Show this help message"
        echo ""
        echo "Examples:"
        echo "  ./version.sh bump          Bump patch version (0.1.0 → 0.1.1)"
        echo "  ./version.sh bump minor    Bump minor version (0.1.0 → 0.2.0)"
        echo "  ./version.sh release       Automated release process"
        ;;
    *)
        echo "❌ Unknown command: $1"
        echo "Run '$0 help' for usage"
        exit 1
        ;;
esac
