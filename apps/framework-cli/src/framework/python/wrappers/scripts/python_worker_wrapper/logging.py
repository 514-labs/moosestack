from logging import getLogger, DEBUG, INFO, StreamHandler, Formatter
import sys

logger_name = "moose-scripts"

handler = StreamHandler(sys.stdout)
handler.setFormatter(Formatter("%(levelname)s | %(name)s | %(message)s"))

# This logger is used by moose scripts runner.
# We also create a logger when the user defines their workflow tasks.
# Both have the same name so we can re-use the handler.
log = getLogger(logger_name)
log.setLevel(INFO)
log.handlers = [handler]


class ForwardingHandler(StreamHandler):
    def emit(self, record):
        record.name = logger_name
        log.handle(record)


# Temporal already has a named logger.
# This is how we route log lines from temporal to moose.
temporal_logger = getLogger("temporalio")
temporal_logger.setLevel(DEBUG)
temporal_logger.handlers = [ForwardingHandler()]
