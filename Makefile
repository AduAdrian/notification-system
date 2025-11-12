.PHONY: help install build dev test clean docker-up docker-down k8s-deploy

help: ## Show this help message
	@echo 'Usage: make [target]'
	@echo ''
	@echo 'Available targets:'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install dependencies
	npm install --workspaces

build: ## Build all services
	npm run build --workspaces

dev: ## Run all services in development mode
	npm run dev

test: ## Run tests
	npm run test --workspaces

clean: ## Clean build artifacts
	find . -name 'dist' -type d -exec rm -rf {} +
	find . -name 'node_modules' -type d -exec rm -rf {} +

docker-build: ## Build Docker images
	docker-compose build

docker-up: ## Start all services with Docker Compose
	docker-compose up -d

docker-down: ## Stop all Docker Compose services
	docker-compose down

docker-logs: ## View logs from all services
	docker-compose logs -f

k8s-deploy: ## Deploy to Kubernetes
	kubectl apply -f infrastructure/kubernetes/

k8s-delete: ## Delete Kubernetes deployment
	kubectl delete -f infrastructure/kubernetes/

lint: ## Run linter
	npm run lint

format: ## Format code
	npx prettier --write .
