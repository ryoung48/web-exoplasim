
      subroutine gcm_publish_step
      use pumamod
      use vegmod, only: dlai
      use landmod, only: doro
      use, intrinsic :: iso_c_binding
      interface
         integer(c_int) function gcm_should_publish(kstep)               &
     &      bind(c, name='gcm_should_publish')
         import :: c_int
         integer(c_int), value :: kstep
         end function gcm_should_publish
         integer(c_int) function gcm_should_stop()                       &
     &      bind(c, name='gcm_should_stop')
         import :: c_int
         end function gcm_should_stop
         subroutine gcm_publish(pf, kfields, kpoints, kbytes, kstep,      &
     &      kdate) bind(c, name='gcm_publish')
         import :: c_int
         type(*), dimension(*) :: pf
         integer(c_int), value :: kfields, kpoints, kbytes, kstep
         integer(c_int), dimension(*) :: kdate
         end subroutine gcm_publish
      end interface
      integer, parameter :: NSURFACE = 35
      integer, parameter :: NFIELDS = NSURFACE + 5*NLEV
      real, parameter :: SLP_LAPSE = 0.0065, SLP_COLD = 255.0
      real, parameter :: GEOPOT_TOL = 1.0e-4, TEMP_TOL = 1.0e-6
!     ExoPlaSim's postprocessor: hfns = snow melt * L_TIMES_RHOH2O + rss
!     + rls + hfss + hfls (pyburn.py, L_TIMES_RHOH2O = -333700000)
      real, parameter :: L_TIMES_RHOH2O = -333700000.0
      real :: zl(NHOR,NFIELDS)
      real :: zg(NUGP,NFIELDS)
      real :: zqsat(NHOR)
      real :: zstar, zmsl, zprt, zprtal
      integer(c_int) :: idate(5)
      integer :: jjet, jlevel, jfield, jpoint
      integer :: istop(1)
      integer(c_int) :: ipublish
      ipublish = gcm_should_publish(int(nstep, c_int))
!     Rank 0 decides and broadcasts, so every rank shuts down on the same
!     step and the epilog writes plasim_status as at the end of a run.
      istop(1) = 0
      if (mypid == NROOT) istop(1) = gcm_should_stop()
      call mpbci(istop)
      if (istop(1) /= 0) nshutdown = 1
      if (ipublish == 0) return
      jjet = minloc(abs(sigma(1:NLEV) - 0.25), 1)
      zl(:,1)  = dt(:,NLEP)
      zl(:,2)  = dtsa(:)
      zl(:,3)  = du(:,NLEV)
      zl(:,4)  = dv(:,NLEV)
      zl(:,5)  = dcc(:,NLEP)
      zl(:,6)  = dprc(:) + dprl(:)
      zl(:,7)  = dp(:)
      zl(:,8)  = dqvi(:)
      zl(:,9)  = dicec(:)
      zl(:,10) = dsnow(:)
      zl(:,11) = dwatc(:)
      zl(:,12) = dalb(:)
      zl(:,13) = du(:,jjet)
      zl(:,14) = dv(:,jjet)
      zl(:,15) = -dlwfl(:,1)
      zl(:,16) = dls(:)
      zl(:,17) = dswfl(:,1) + dlwfl(:,1)
      zl(:,18) = dsmelt(:) * L_TIMES_RHOH2O + dswfl(:,NLEP)              &
     &         + dlwfl(:,NLEP) + dshfl(:) + dlhfl(:)
      zl(:,19) = -devap(:)
      zl(:,20) = drunoff(:)
      zl(:,21) = dforest(:)
      zl(:,22) = 0.0
      if (nveg > 0 .and. allocated(dlai)) zl(:,22) = dlai(:)
      zl(:,23) = dprs(:)
      zl(:,24) = dsmelt(:)
      zl(:,25) = diced(:)
      zl(:,26) = dglac(:)
!     Same sea-level reduction as ExoPlaSim pyburn's slpcode branch.
      zl(:,27) = dp(:)
      do jpoint=1,NHOR
         if (abs(doro(jpoint)) < GEOPOT_TOL) cycle
         zstar = (1.0+gascon*SLP_LAPSE/ga                             &
     &      *(1.0/sigma(NLEV)-1.0))*dt(jpoint,NLEV)
         if (zstar < SLP_COLD) zstar = 0.5*(SLP_COLD+zstar)
         zmsl = zstar+doro(jpoint)*SLP_LAPSE/ga
         zprt = doro(jpoint)/(gascon*zstar)
         zprtal = 0.0
         if (abs(zmsl-zstar) >= TEMP_TOL) then
            zprtal = zprt*gascon*(zmsl-zstar)/doro(jpoint)
         endif
         zl(jpoint,27) = dp(jpoint)                                  &
     &      *exp(zprt*(1.0-zprtal*(0.5-zprtal/3.0)))
      enddo
      zl(:,28) = dswfl(:,NLEP)
      zl(:,29) = dlwfl(:,NLEP)
      zl(:,30) = dshfl(:)
      zl(:,31) = dlhfl(:)
      zl(:,32) = dprc(:)
      zl(:,33) = dprl(:)
      zl(:,34) = dswfl(:,1)
      zl(:,35) = dlwfl(:,1)
      do jlevel=1,NLEV
         jfield = NSURFACE + 5*(jlevel-1)
         zl(:,jfield+1) = dt(:,jlevel)
         zl(:,jfield+2) = du(:,jlevel)
         zl(:,jfield+3) = dv(:,jlevel)
!        Same saturation relation and constants as rainmod's mkclouds.
         zqsat(:) = rdbrv*ra1*exp(ra2*(dt(:,jlevel)-TMELT)              &
     &      /(dt(:,jlevel)-ra4))/(dp(:)*sigma(jlevel))
         zqsat(:) = min(zqsat(:),rdbrv)
         zqsat(:) = zqsat(:)/(1.-(1./rdbrv-1.)*zqsat(:))
         zl(:,jfield+4) = max(0.0,dq(:,jlevel))                        &
     &      /max(tiny(1.0),zqsat(:))
         zl(:,jfield+5) = dcc(:,jlevel)
      enddo
      call mpgagp(zg, zl, NFIELDS)
      if (mypid == NROOT) then
         idate(:) = ndatim(1:5)
         call gcm_publish(zg, NFIELDS, NUGP, storage_size(zg(1,1)) / 8,     &
     &                    int(nstep, c_int), idate)
      endif
      end subroutine gcm_publish_step
