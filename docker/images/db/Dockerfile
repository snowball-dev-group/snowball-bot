FROM mariadb:latest
COPY ./my.cfg /etc/mysql-scrs/
EXPOSE 3306
CMD [ "--defaults-extra-file=/etc/mysql-scrs/my.cfg" ]
