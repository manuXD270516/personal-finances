# CRLF experiment (THROWAWAY): the entrypoint script is copied as-is from the working tree.
FROM alpine:3
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
CMD ["echo", "app started"]
