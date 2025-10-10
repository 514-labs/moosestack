#!/usr/bin/env python3
"""
Setup script for py-moose-lib-extras
"""

from setuptools import setup, find_packages
import os

# Read the README file
def read_readme():
    readme_path = os.path.join(os.path.dirname(__file__), 'README.md')
    if os.path.exists(readme_path):
        with open(readme_path, 'r', encoding='utf-8') as f:
            return f.read()
    return ""

# Read requirements
def read_requirements():
    requirements_path = os.path.join(os.path.dirname(__file__), 'requirements.txt')
    if os.path.exists(requirements_path):
        with open(requirements_path, 'r', encoding='utf-8') as f:
            return [line.strip() for line in f if line.strip() and not line.startswith('#')]
    return []

setup(
    name="moose-lib-extras",
    version="0.1.0",
    python_requires=">=3.8",
    description="A collection of extra utilities and extensions for the Moose library",
    long_description=read_readme(),
    long_description_content_type="text/markdown",
    author='Fiveonefour Labs Inc.',
    author_email="support@fiveonefour.com",
    url="https://www.fiveonefour.com/moose",
    packages=find_packages(),
    install_requires=read_requirements(),
    extras_require={
        "dev": [
            "pytest>=6.0",
            "pytest-cov>=2.0",
            "black>=21.0",
            "flake8>=3.8",
            "mypy>=0.800",
            "sphinx>=4.0",
            "sphinx-rtd-theme>=0.5",
        ],
        "test": [
            "pytest>=6.0",
            "pytest-cov>=2.0",
        ],
    },
    include_package_data=True,
    zip_safe=False,
)