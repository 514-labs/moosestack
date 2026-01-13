from setuptools import setup

setup(
    name="live-heart-rate-app",
    version="0.0",
    install_requires=[
        "kafka-python-ng==2.2.2",
        "clickhouse_connect==0.7.16",
        "requests==2.32.4",
        "moose-cli==0.6.309",
        "moose-lib==0.6.309",
        "streamlit>=1.32.0",
    ],
)
