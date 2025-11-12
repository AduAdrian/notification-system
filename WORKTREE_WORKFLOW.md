# Git Worktree Workflow Guide

## Overview

This project uses **git worktree** for parallel development across multiple microservices. Each worktree is a separate directory with its own branch checked out.

## Repository Structure

```
C:\Users\Adrian\
├── notification-system/              [master] - Production/Main
├── notification-system-dev/          [develop] - Development/Testing
├── notification-system-email/        [feature/email-service]
├── notification-system-sms/          [feature/sms-service]
├── notification-system-push/         [feature/push-service]
└── notification-system-orchestrator/ [feature/orchestrator]
```

## GitHub Repository

**URL**: https://github.com/AduAdrian/notification-system

**Branches on GitHub:**
- `master` - Production branch
- `develop` - Development/integration branch
- `feature/email-service` - Email notification service
- `feature/sms-service` - SMS notification service
- `feature/push-service` - Push notification service
- `feature/orchestrator` - Channel orchestrator service

## Daily Workflow

### Working on Email Service

```bash
cd C:\Users\Adrian\notification-system-email

# Make changes
git add .
git commit -m "Add email template engine"
git push
```

### Working on SMS Service (in parallel)

```bash
# Open another terminal
cd C:\Users\Adrian\notification-system-sms

# Make changes independently
git add .
git commit -m "Add Twilio integration"
git push
```

### Integration Testing

```bash
cd C:\Users\Adrian\notification-system-dev

# Merge feature branches for testing
git merge feature/email-service
git merge feature/sms-service

# Test integration
npm test

# Push to develop
git push
```

### Production Release

```bash
cd C:\Users\Adrian\notification-system

# Merge from develop
git merge develop

# Tag release
git tag -a v1.0.0 -m "First release"
git push --tags
```

## Worktree Management Commands

### List all worktrees
```bash
cd notification-system
git worktree list
```

### Add a new worktree
```bash
cd notification-system
git worktree add ../notification-system-analytics feature/analytics-service
```

### Remove a worktree
```bash
git worktree remove ../notification-system-email
# Or manually delete directory and prune
rm -rf ../notification-system-email
git worktree prune
```

### Check worktree status
```bash
# In any worktree
git status
git branch -vv  # See tracking branches
```

## Benefits

✅ **No branch switching** - Each service has its own directory
✅ **Parallel development** - Work on multiple features simultaneously
✅ **No stashing** - Work-in-progress stays in its worktree
✅ **Faster testing** - Run tests in one worktree while coding in another
✅ **Shared .git** - All worktrees share the same repository (saves space)

## Best Practices

1. **Keep worktrees focused** - One worktree per feature/service
2. **Regular commits** - Commit frequently in each worktree
3. **Sync with origin** - Pull/push regularly to stay updated
4. **Clean up** - Remove worktrees when features are merged
5. **Use descriptive branches** - Clear naming like `feature/email-service`

## Common Commands Reference

```bash
# Navigate to worktree
cd notification-system-email

# Check current branch
git branch --show-current

# Pull latest changes
git pull origin feature/email-service

# Push changes
git push origin feature/email-service

# Create and switch to new branch in worktree
git checkout -b feature/email-templates

# Merge from develop
git fetch origin
git merge origin/develop

# Rebase on develop
git rebase origin/develop
```

## Troubleshooting

### Worktree is locked
```bash
cd notification-system
git worktree unlock ../notification-system-email
```

### Remove stale worktrees
```bash
git worktree prune
```

### Check worktree integrity
```bash
git worktree list
git fsck
```

## Team Collaboration

When working in a team:
1. Each developer can have their own worktree setup
2. Push changes to feature branches regularly
3. Use `develop` branch for integration
4. Create PRs from feature branches to `develop`
5. Merge `develop` to `master` for releases

## Next Steps

1. Start developing in each service worktree
2. Set up CI/CD pipelines for each branch
3. Configure branch protection rules on GitHub
4. Create pull request templates
5. Set up automated testing

---

**Repository**: https://github.com/AduAdrian/notification-system
**Documentation**: notification_system_architecture.md
**Created with**: Claude Code
