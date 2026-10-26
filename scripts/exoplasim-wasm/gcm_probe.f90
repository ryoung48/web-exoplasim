!     Values are written in the build's default real kind and the index
!     starts with their byte size. -freal-8-real-4 demotes every kind-8
!     declaration, so no fixed kind would stay 8 bytes in the f32 build.
      subroutine gcm_probe_write(kunit, cname, pvalues, kcount)
      integer, intent(in) :: kunit, kcount
      character(len=*), intent(in) :: cname
      real, intent(in) :: pvalues(kcount)
      write(kunit) pvalues
      write(kunit+1,'(a,1x,i0)') cname, kcount
      end subroutine gcm_probe_write

      subroutine gcm_probe_open(kunit, cname)
      integer, intent(in) :: kunit
      character(len=*), intent(in) :: cname
      open(kunit, file=cname//'.bin', access='stream',                   &
     &     form='unformatted', status='replace')
      open(kunit+1, file=cname//'.txt', status='replace')
      write(kunit+1,'(a,1x,i0)') '#bytes', storage_size(0.0) / 8
      end subroutine gcm_probe_open

!     Dumps every pumamod variable at probe point cpoint on the steps listed
!     in probe-steps.txt (one per line, counted from the start of the run),
!     as probe-<step>-<point>.bin/.txt.
      subroutine gcm_probe_state(cpoint)
      use pumamod
      character(len=*), intent(in) :: cpoint
      integer, save :: isteps(64)
      integer, save :: icount = -1
      integer :: ios
      character(len=64) :: yname
      if (icount < 0) then
         icount = 0
         open(97, file='probe-steps.txt', status='old', iostat=ios)
         if (ios == 0) then
            do
               read(97, *, iostat=ios) isteps(icount + 1)
               if (ios /= 0) exit
               icount = icount + 1
            enddo
            close(97)
         endif
      endif
      if (mypid /= NROOT .or. .not. any(isteps(1:icount) == nstep - nstep1)) return
      write(yname, '(a,i0,a,a)') 'probe-', nstep - nstep1, '-', cpoint
      call gcm_probe_open(95, trim(yname))
      call gcm_probe_state_dump
      close(95)
      close(96)
!     Replay: continue from another run's state at this point, converted to
!     this build's precision, so the next routine runs on that run's inputs.
      write(yname, '(a,i0,a,a)') 'replay-', nstep - nstep1, '-', cpoint
      open(95, file=trim(yname)//'.bin', access='stream',                &
     &     form='unformatted', status='old', iostat=ios)
      if (ios == 0) then
         call gcm_probe_state_load(95)
         close(95)
      endif
      end subroutine gcm_probe_state

!     Dumps every pumamod variable once, during set-up, as probe-<cname>.
      subroutine gcm_probe_init(cname)
      use pumamod
      character(len=*), intent(in) :: cname
      if (mypid /= NROOT) return
      call gcm_probe_open(95, 'probe-'//cname)
      call gcm_probe_state_dump
      close(95)
      close(96)
      end subroutine gcm_probe_init

      subroutine gcm_probe_tables
      use legmod
      real :: zi(NLON,NLON)
      integer :: j
      if (mypid /= NROOT) return
      call gcm_probe_open(93, 'probe-tables')
      call gcm_probe_write(93, 'sid', real(sid), NLAT)
      call gcm_probe_write(93, 'gwd', real(gwd), NLAT)
      call gcm_probe_write(93, 'qi', reshape(qi, [size(qi)]), size(qi))
      call gcm_probe_write(93, 'qj', reshape(qj, [size(qj)]), size(qj))
      call gcm_probe_write(93, 'qc', reshape(qc, [size(qc)]), size(qc))
      call gcm_probe_write(93, 'qe', reshape(qe, [size(qe)]), size(qe))
      call gcm_probe_write(93, 'qm', reshape(qm, [size(qm)]), size(qm))
      call gcm_probe_write(93, 'qq', reshape(qq, [size(qq)]), size(qq))
      call gcm_probe_write(93, 'qu', reshape(qu, [size(qu)]), size(qu))
      call gcm_probe_write(93, 'qv', reshape(qv, [size(qv)]), size(qv))
      call gcm_probe_write(93, 'skgpsp', skgpsp, NTP1)
      call gcm_probe_write(93, 'skspgp', skspgp, NTP1)
!     Each column j is the transform of unit vector j, so these are the
!     exact matrices of gp2fc and fc2gp.
      zi(:,:) = 0.0
      do j = 1, NLON
         zi(j,j) = 1.0
      enddo
      call gp2fc(zi, NLON, NLON)
      call gcm_probe_write(93, 'gp2fc', reshape(zi, [NLON*NLON]), NLON*NLON)
      zi(:,:) = 0.0
      do j = 1, NLON
         zi(j,j) = 1.0
      enddo
      call fc2gp(zi, NLON, NLON)
      call gcm_probe_write(93, 'fc2gp', reshape(zi, [NLON*NLON]), NLON*NLON)
      close(93)
      close(94)
      end subroutine gcm_probe_tables
