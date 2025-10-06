.PHONY: help install install-dev test lint format clean build publish

help:  ## Show this help message
	@echo "Available commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

install:  ## Install the package
	pip install .

install-dev:  ## Install the package in development mode with all dependencies
	pip install -e ".[dev]"

test:  ## Run tests
	pytest

test-cov:  ## Run tests with coverage
	pytest --cov=moose_lib_extras --cov-report=html --cov-report=term-missing

lint:  ## Run linting
	flake8 moose_lib_extras tests
	mypy moose_lib_extras

format:  ## Format code
	black moose_lib_extras tests
	isort moose_lib_extras tests

format-check:  ## Check code formatting
	black --check moose_lib_extras tests
	isort --check-only moose_lib_extras tests

clean:  ## Clean build artifacts
	rm -rf build/
	rm -rf dist/
	rm -rf *.egg-info/
	rm -rf .pytest_cache/
	rm -rf .coverage
	rm -rf htmlcov/
	find . -type d -name __pycache__ -delete
	find . -type f -name "*.pyc" -delete

build: clean  ## Build the package
	python -m build

publish-test: build  ## Publish to TestPyPI
	twine upload --repository testpypi dist/*

publish: build  ## Publish to PyPI
	twine upload dist/*

check: format-check lint test  ## Run all checks

all: clean install-dev check  ## Run everything
