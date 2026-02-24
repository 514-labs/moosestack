from setuptools import setup

setup(
    name="github-star-analytics-py",
    version="0.0",
    install_requires=[
        "kafka-python-ng==2.2.2",
        "clickhouse_connect==0.11.0",
        "requests==2.32.4",
        "moose-cli",
        "moose-lib",
        "python-dotenv",
    ],
)
