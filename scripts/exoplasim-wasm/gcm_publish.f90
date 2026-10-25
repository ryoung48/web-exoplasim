
      subroutine gcm_publish_step
      use pumamod
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
      integer, parameter :: NFIELDS = 18
!     ExoPlaSim's postprocessor: hfns = snow melt * L_TIMES_RHOH2O + rss
!     + rls + hfss + hfls (pyburn.py, L_TIMES_RHOH2O = -333700000)
      real, parameter :: L_TIMES_RHOH2O = -333700000.0
      real :: zl(NHOR,NFIELDS)
      real :: zg(NUGP,NFIELDS)
      integer(c_int) :: idate(5)
      integer :: jjet
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
      call mpgagp(zg, zl, NFIELDS)
      if (mypid == NROOT) then
         idate(:) = ndatim(1:5)
         call gcm_publish(zg, NFIELDS, NUGP, storage_size(zg(1,1)) / 8,     &
     &                    int(nstep, c_int), idate)
      endif
      end subroutine gcm_publish_step
