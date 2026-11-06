"""Kontrollerer den rigtige terminalgrænseflade på Unix. Kun syntetiske data."""
import errno
import json
import os
import pty
import re
import select
import signal
import sys
import time
import urllib.request

node, cli, project, state, endpoint, transcript = sys.argv[1:]
secret = 'aura_cli_synthetic_secret_12345'
password = 'syntetisk adgangssaetning'
history = bytearray()


def session(steps):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ['AURA_HOME'] = state
        os.environ['AURA_KEYCHAIN'] = 'off'
        os.execv(node, [node, cli, 'chat', project])
    pending = bytearray()
    try:
        for pattern, answer in steps:
            deadline = time.monotonic() + 100
            while pattern.encode() not in pending:
                if time.monotonic() > deadline:
                    raise RuntimeError('Terminalen nåede ikke til: ' + pattern)
                ready, _, _ = select.select([fd], [], [], 0.2)
                if ready:
                    try:
                        chunk = os.read(fd, 65536)
                    except OSError as error:
                        if error.errno == errno.EIO:
                            raise RuntimeError('Terminalen lukkede før: ' + pattern)
                        raise
                    if not chunk:
                        raise RuntimeError('Terminalen lukkede før: ' + pattern)
                    pending.extend(chunk)
                    history.extend(chunk)
            index = pending.index(pattern.encode()) + len(pattern.encode())
            pending = pending[index:]
            if callable(answer):
                result = answer()
                if result:
                    os.write(fd, result.encode())
            else:
                os.write(fd, answer.encode())
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                if os.waitstatus_to_exitcode(status) != 0:
                    raise RuntimeError('Terminalen afsluttede med fejl')
                return
            ready, _, _ = select.select([fd], [], [], 0.1)
            if ready:
                try:
                    history.extend(os.read(fd, 65536))
                except OSError:
                    pass
        raise RuntimeError('Terminalen lukkede ikke efter /exit')
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        os.close(fd)


def preview_check():
    matches = re.findall(rb'http://127\.0\.0\.1:\d+/[^\s\x1b]+', history)
    url = next(u.decode() for u in reversed(matches) if b'/v1' not in u)
    with urllib.request.urlopen(url) as response:
        assert 'Bygget i terminalen' in response.read().decode()
    return 'nej\n'


def stop_check():
    deadline = time.monotonic() + 100
    while not os.path.exists(os.path.join(state, 'test-wait')):
        if time.monotonic() > deadline:
            raise RuntimeError('Stopprøven nåede ikke modelserveren')
        time.sleep(0.05)
    return '\x03'


try:
    session([
        ('Dig: ', '/login compatible\n'),
        ('Serveradresse: ', endpoint + '\n'),
        ('Forbindelsens navn', '\n'),
        ('API-nøgle (tom ved ingen): ', secret + '\n'),
        ('Ny adgangssætning (mindst 12 tegn): ', password + '\n'),
        ('Gentag adgangssætningen: ', password + '\n'),
        ('Vælg nummer, søg med tekst eller skriv tilbage: ', '1\n'),
        ('Dig: ', 'Planlæg en enkel startside\n'),
        ('Vælg nummer, søg med tekst eller skriv tilbage: ', '1\n'),
        ('Planen er gemt.', lambda: None),
        ('Dig: ', '/build\n'),
        ('Byg efter denne plan? (ja/NEJ): ', 'ja\n'),
        ('Tillad denne handling én gang? (ja/NEJ): ', 'ja\n'),
        ('Næste besked kan ændre resultatet.', lambda: None),
        ('Dig: ', '/preview\n'),
        ('Åbn i browseren? (ja/NEJ): ', lambda: preview_check()),
        ('Dig: ', 'Afvis ændringen\n'),
        ('Tillad denne handling én gang? (ja/NEJ): ', 'nej\n'),
        ('Der blev ikke ændret filer i denne opgave.', lambda: None),
        ('Dig: ', '/diff\n'),
        ('Vælg nummer, søg med tekst eller skriv tilbage: ', '1\n'),
        ('Dig: ', 'Vent på svar\n'),
        ('AI arbejder.', stop_check),
        ('Opgaven er stoppet.', lambda: None),
        ('Dig: ', 'Efter stop: Afvis ændringen\n'),
        ('Tillad denne handling én gang? (ja/NEJ): ', 'nej\n'),
        ('Der blev ikke ændret filer i denne opgave.', lambda: None),
        ('Dig: ', '/exit\n'),
    ])
    session([
        ('Samtalen er genåbnet.', lambda: None),
        ('Dig: ', '/history\n'),
        ('Dig: ', '/work\n'),
        ('Dig: ', 'Forbindelsesfejl\n'),
        ('Adgangssætning til nøglelager: ', password + '\n'),
        ('Dig: ', '/exit\n'),
    ])
    assert secret.encode() not in history, 'Nøglen må ikke blive skrevet i terminalen'
    assert password.encode() not in history, 'Adgangssætningen må ikke blive skrevet i terminalen'
    assert 'Agentmotoren stoppede'.encode() not in history, 'Ctrl+C må ikke slå motoren ned'
    assert 'hændelser blev afbrudt'.encode() not in history, 'Ctrl+C må ikke bryde hændelsesforbindelsen'
    print(json.dumps({'status': 'bestået', 'kontroller': ['login', 'skjult nøgle', 'krypteret genåbning', 'plan', 'byg', 'tilladelse', 'afvisning', 'preview', 'diff', 'stop', 'samtalehistorik', 'forbindelsesfejl']}))
finally:
    with open(transcript, 'wb') as output:
        output.write(history.replace(secret.encode(), b'[skjult testnoegle]').replace(password.encode(), b'[skjult testadgang]'))
