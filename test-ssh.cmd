@echo off
ssh -i "D:\photo-coach-pages\.deploy-key\id_ed25519" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile="D:\photo-coach-pages\.deploy-key\known_hosts" -T git@github.com 2>&1
