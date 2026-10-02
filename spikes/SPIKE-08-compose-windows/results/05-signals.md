| Servicio | PID 1 | Handler ejecutado | Exit code | Tiempo de stop (ms) |
|---|---|---|---|---|
| sig-node-pid1-handler | `node api.mjs` | yes (drained) | 0 | 2218 |
| sig-node-pid1-nohandler | `node api.mjs` | no | 137 | 10795 |
| sig-tini-handler | `/sbin/docker-init -- node api.mjs` | yes (drained) | 0 | 2408 |
| sig-tini-nohandler | `/sbin/docker-init -- node api.mjs` | no | 143 | 1005 |
| sig-shell-wrapper | `sh -c node api.mjs; echo node exited $?` | no | 137 | 10983 |
| sig-shell-wrapper-tini | `/sbin/docker-init -- sh -c node api.mjs; echo node exited $?` | no | 143 | 893 |
| sig-npm-start | `npm start` | yes (drained) | 0 | 2429 |
| zombie-no-init | zombies (stat Z) after ~20 s | — | — | 115 zombies |
| zombie-tini | zombies (stat Z) after ~20 s | — | — | 0 zombies |

## Logs

```text
### sig-node-pid1-handler (PID1: node api.mjs) stop=2218ms exit=0
2026-10-02T01:21:08.524Z [A-node-pid1-handler pid=1] SIGTERM handler installed for api
2026-10-02T01:21:08.526Z [A-node-pid1-handler pid=1] api listening on 8080
2026-10-02T01:21:16.278Z [A-node-pid1-handler pid=1] SHUTDOWN_HANDLER_START signal=SIGTERM
2026-10-02T01:21:16.278Z [A-node-pid1-handler pid=1] closing HTTP server (stop accepting new connections)
2026-10-02T01:21:16.279Z [A-node-pid1-handler pid=1] simulating in-flight drain 1500ms
2026-10-02T01:21:17.780Z [A-node-pid1-handler pid=1] SHUTDOWN_HANDLER_DONE in 1502ms -> exit 0

### sig-node-pid1-nohandler (PID1: node api.mjs) stop=10795ms exit=137
2026-10-02T01:21:07.848Z [B-node-pid1-nohandler pid=1] NO SIGTERM handler installed (experiment)
2026-10-02T01:21:07.850Z [B-node-pid1-nohandler pid=1] api listening on 8080

### sig-tini-handler (PID1: /sbin/docker-init -- node api.mjs) stop=2408ms exit=0
2026-10-02T01:21:08.304Z [C-tini-handler pid=8] SIGTERM handler installed for api
2026-10-02T01:21:08.305Z [C-tini-handler pid=8] api listening on 8080
2026-10-02T01:21:30.976Z [C-tini-handler pid=8] SHUTDOWN_HANDLER_START signal=SIGTERM
2026-10-02T01:21:30.976Z [C-tini-handler pid=8] closing HTTP server (stop accepting new connections)
2026-10-02T01:21:30.977Z [C-tini-handler pid=8] simulating in-flight drain 1500ms
2026-10-02T01:21:32.479Z [C-tini-handler pid=8] SHUTDOWN_HANDLER_DONE in 1503ms -> exit 0

### sig-tini-nohandler (PID1: /sbin/docker-init -- node api.mjs) stop=1005ms exit=143
2026-10-02T01:21:07.586Z [D-tini-nohandler pid=7] NO SIGTERM handler installed (experiment)
2026-10-02T01:21:07.588Z [D-tini-nohandler pid=7] api listening on 8080

### sig-shell-wrapper (PID1: sh -c node api.mjs; echo node exited $?) stop=10983ms exit=137
2026-10-02T01:21:08.803Z [E-shell-wrapper pid=7] SIGTERM handler installed for api
2026-10-02T01:21:08.806Z [E-shell-wrapper pid=7] api listening on 8080

### sig-shell-wrapper-tini (PID1: /sbin/docker-init -- sh -c node api.mjs; echo node exited $?) stop=893ms exit=143
2026-10-02T01:21:08.091Z [F-shell-wrapper-tini pid=8] SIGTERM handler installed for api
2026-10-02T01:21:08.093Z [F-shell-wrapper-tini pid=8] api listening on 8080

### sig-npm-start (PID1: npm start) stop=2429ms exit=0
2026-10-02T01:21:10.029Z [G-npm-start pid=18] SIGTERM handler installed for api
2026-10-02T01:21:10.033Z [G-npm-start pid=18] api listening on 8080
2026-10-02T01:21:49.747Z [G-npm-start pid=18] SHUTDOWN_HANDLER_START signal=SIGTERM
2026-10-02T01:21:49.748Z [G-npm-start pid=18] closing HTTP server (stop accepting new connections)
2026-10-02T01:21:49.749Z [G-npm-start pid=18] simulating in-flight drain 1500ms
2026-10-02T01:21:51.250Z [G-npm-start pid=18] SHUTDOWN_HANDLER_DONE in 1503ms -> exit 0

### zombie-no-init: 115 zombies
PID   PPID  STAT COMMAND
    1     0 S    node
   15     1 Z    sleep
   17     1 Z    sleep
   19     1 Z    sleep
   21     1 Z    sleep
   23     1 Z    sleep
   25     1 Z    sleep
   27     1 Z    sleep
   29     1 Z    sleep
   31     1 Z    sleep
   33     1 Z    sleep
...
### zombie-tini: 0 zombies
PID   PPID  STAT COMMAND
    1     0 S    docker-init
    7     1 S    node
  249     0 R    ps

...
```
